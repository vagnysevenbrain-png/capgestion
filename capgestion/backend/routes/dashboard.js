const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function n(value) {
    const v = Number(value);
    return Number.isFinite(v) ? v : 0;
}

function isoDate(value) {
    if (!value) return null;
    return String(value).slice(0, 10);
}

function pick(obj, keys, fallback = 0) {
    if (!obj) return fallback;
    for (const key of keys) {
        if (obj[key] !== undefined && obj[key] !== null) {
            return obj[key];
        }
    }
    return fallback;
}

async function getLatestRapport(siteId) {
    const result = await db.query(
        `
    SELECT *
    FROM rapports
    WHERE site_id = $1
    ORDER BY date_rapport DESC, id DESC
    LIMIT 1
    `,
        [siteId]
    );
    return result.rows[0] || null;
}

async function getRapportSoldes(rapportId) {
    if (!rapportId) return null;
    const result = await db.query(
        `
    SELECT *
    FROM rapport_soldes
    WHERE rapport_id = $1
    LIMIT 1
    `,
        [rapportId]
    );
    return result.rows[0] || null;
}

async function getRapportGaz(rapportId) {
    if (!rapportId) return null;
    const result = await db.query(
        `
    SELECT *
    FROM rapport_gaz
    WHERE rapport_id = $1
    LIMIT 1
    `,
        [rapportId]
    );
    return result.rows[0] || null;
}

async function getRapportDepensesTotal(rapportId) {
    if (!rapportId) return 0;
    try {
        const result = await db.query(
            `
      SELECT COALESCE(SUM(montant), 0) AS total_depenses
      FROM rapport_depenses
      WHERE rapport_id = $1
      `,
            [rapportId]
        );
        return n(result.rows[0]?.total_depenses);
    } catch (err) {
        console.error('Erreur total dépenses rapport:', err);
        return 0;
    }
}

async function getFallbackFondMM(siteId) {
    const result = await db.query(
        `
    SELECT *
    FROM fond_mm
    WHERE site_id = $1
    ORDER BY id DESC
    LIMIT 1
    `,
        [siteId]
    );
    return result.rows[0] || null;
}

async function getGazConfig(siteId) {
    const result = await db.query(
        `
    SELECT *
    FROM gaz_config
    WHERE site_id = $1
    LIMIT 1
    `,
        [siteId]
    );
    return result.rows[0] || null;
}

async function getComptesClientsStats(siteId) {
    const result = await db.query(
        `
    WITH soldes AS (
      SELECT
        cc.id,
        cc.actif,
        COALESCE(SUM(
          CASE
            WHEN m.type_mvt IN ('credit', 'avance', 'ajustement_plus') THEN m.montant
            WHEN m.type_mvt IN ('remboursement', 'ajustement_moins') THEN -m.montant
            ELSE 0
          END
        ), 0) AS solde
      FROM comptes_clients cc
      LEFT JOIN compte_client_mouvements m
        ON m.compte_client_id = cc.id
      WHERE cc.site_id = $1
      GROUP BY cc.id, cc.actif
    )
    SELECT
      COUNT(*) FILTER (WHERE actif = true)  AS comptes_actifs,
      COUNT(*) FILTER (WHERE actif = false) AS comptes_inactifs,
      COALESCE(SUM(CASE WHEN solde > 0 THEN solde ELSE 0 END), 0) AS total_clients_debiteurs,
      COALESCE(SUM(CASE WHEN solde < 0 THEN ABS(solde) ELSE 0 END), 0) AS total_clients_crediteurs,
      COALESCE(SUM(solde), 0) AS solde_net_comptes_clients
    FROM soldes
    `,
        [siteId]
    );

    return result.rows[0] || {
        comptes_actifs: 0,
        comptes_inactifs: 0,
        total_clients_debiteurs: 0,
        total_clients_crediteurs: 0,
        solde_net_comptes_clients: 0
    };
}

async function getFondMisADisposition(siteId) {
    try {
        const result = await db.query(
            `
      SELECT
        COALESCE(SUM(
          CASE
            WHEN type_mvt = 'appro' THEN montant
            WHEN type_mvt = 'retrait' THEN -montant
            ELSE 0
          END
        ), 0) AS fond_mis_a_disposition
      FROM fond_mm_proprietaire_mouvements
      WHERE site_id = $1
      `,
            [siteId]
        );

        return n(result.rows[0]?.fond_mis_a_disposition);
    } catch (err) {
        console.error('Erreur calcul fond mis à disposition:', err);
        return 0;
    }
}

router.get('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;

    try {
        const [latestRapport, fallbackFond, gazConfig, comptesClients, fondMisADisposition] = await Promise.all([
            getLatestRapport(siteId),
            getFallbackFondMM(siteId),
            getGazConfig(siteId),
            getComptesClientsStats(siteId),
            getFondMisADisposition(siteId)
        ]);

        let rapportSoldes = null;
        let rapportGaz = null;
        let totalDepensesJour = 0;

        if (latestRapport) {
            [rapportSoldes, rapportGaz, totalDepensesJour] = await Promise.all([
                getRapportSoldes(latestRapport.id),
                getRapportGaz(latestRapport.id),
                getRapportDepensesTotal(latestRapport.id)
            ]);
        }

        let fondsMM = {
            orange_rev: 0,
            orange_pdv: 0,
            orange_total: 0,
            wave: 0,
            mtn: 0,
            moov: 0,
            moov_p2: 0,
            tresor: 0,
            unites: 0,
            especes: 0,
            fonds_disponibles: 0,
            source: 'aucune_donnee',
            date_source: null
        };

        if (latestRapport && rapportSoldes) {
            const orangeRev = n(pick(rapportSoldes, ['orange_rev']));
            const orangePdv = n(pick(rapportSoldes, ['orange_pdv']));
            const orangeTotal = orangeRev + orangePdv;
            const wave = n(pick(rapportSoldes, ['wave']));
            const mtn = n(pick(rapportSoldes, ['mtn']));
            const moov = n(pick(rapportSoldes, ['moov']));
            const moovP2 = n(pick(rapportSoldes, ['moov_p2']));
            const tresor = n(pick(rapportSoldes, ['tresor']));
            const unites = n(pick(rapportSoldes, ['unites']));
            const especes = n(pick(rapportSoldes, ['especes']));

            fondsMM = {
                orange_rev: orangeRev,
                orange_pdv: orangePdv,
                orange_total: orangeTotal,
                wave,
                mtn,
                moov,
                moov_p2: moovP2,
                tresor,
                unites,
                especes,
                fonds_disponibles: orangeTotal + wave + mtn + moov + moovP2 + tresor + unites + especes,
                source: 'rapport_le_plus_recent',
                date_source: isoDate(latestRapport.date_rapport)
            };
        } else if (fallbackFond) {
            const orangeRev = n(pick(fallbackFond, ['orange_rev']));
            const orangePdv = n(pick(fallbackFond, ['orange_pdv']));
            const orangeTotal = orangeRev + orangePdv;
            const wave = n(pick(fallbackFond, ['wave']));
            const mtn = n(pick(fallbackFond, ['mtn']));
            const moov = n(pick(fallbackFond, ['moov']));
            const moovP2 = n(pick(fallbackFond, ['moov_p2']));
            const tresor = n(pick(fallbackFond, ['tresor']));
            const unites = n(pick(fallbackFond, ['unites']));
            const especes = n(pick(fallbackFond, ['especes']));

            fondsMM = {
                orange_rev: orangeRev,
                orange_pdv: orangePdv,
                orange_total: orangeTotal,
                wave,
                mtn,
                moov,
                moov_p2: moovP2,
                tresor,
                unites,
                especes,
                fonds_disponibles: orangeTotal + wave + mtn + moov + moovP2 + tresor + unites + especes,
                source: 'fond_mm_secours',
                date_source: null
            };
        }

        const b12Pleine = n(pick(gazConfig, ['b12_pleines']));
        const b12Vide = n(pick(gazConfig, ['b12_vides']));
        const b6Pleine = n(pick(gazConfig, ['b6_pleines']));
        const b6Vide = n(pick(gazConfig, ['b6_vides']));
        const b12Recharge = n(pick(gazConfig, ['b12_cout_recharge']));
        const b6Recharge = n(pick(gazConfig, ['b6_cout_recharge']));

        const gaz = {
            b12_pleines: b12Pleine,
            b12_vides: b12Vide,
            b12_stock: b12Pleine + b12Vide,
            b6_pleines: b6Pleine,
            b6_vides: b6Vide,
            b6_stock: b6Pleine + b6Vide,
            b12_cout_recharge: b12Recharge,
            b6_cout_recharge: b6Recharge,
            caisse_theorique_gaz: (b12Vide * b12Recharge) + (b6Vide * b6Recharge)
        };

        const activite = {
            rapport_saisi: !!latestRapport,
            date_rapport_reference: isoDate(latestRapport?.date_rapport),
            b12_vendues: n(pick(rapportGaz, ['b12_vendues', 'b12v'])),
            b12_rechargees: n(pick(rapportGaz, ['b12_rechargees', 'b12r'])),
            b12_fuites: n(pick(rapportGaz, ['b12_fuites', 'b12f'])),
            b6_vendues: n(pick(rapportGaz, ['b6_vendues', 'b6v'])),
            b6_rechargees: n(pick(rapportGaz, ['b6_rechargees', 'b6r'])),
            b6_fuites: n(pick(rapportGaz, ['b6_fuites', 'b6f'])),
            ventes_gaz_jour: n(pick(rapportGaz, ['ventes_gaz_jour'])),
            commission_gaz_jour: n(pick(rapportGaz, ['commission_gaz_jour'])),
            caisse_gaz_disponible: n(pick(rapportGaz, ['caisse_gaz_disponible'])),
            ecart_caisse_gaz: n(pick(rapportGaz, ['caisse_gaz_disponible'])) - gaz.caisse_theorique_gaz,
            total_depenses_jour: totalDepensesJour
        };

        const tresorerieCorrigee =
            n(fondsMM.fonds_disponibles) + n(comptesClients.solde_net_comptes_clients);

        const perteOuExcedent =
            tresorerieCorrigee - n(fondMisADisposition);

        res.json({
            date_du_jour: isoDate(new Date().toISOString()),
            fonds_mm: fondsMM,
            comptes_clients: {
                comptes_actifs: n(comptesClients.comptes_actifs),
                comptes_inactifs: n(comptesClients.comptes_inactifs),
                total_clients_debiteurs: n(comptesClients.total_clients_debiteurs),
                total_clients_crediteurs: n(comptesClients.total_clients_crediteurs),
                solde_net_comptes_clients: n(comptesClients.solde_net_comptes_clients)
            },
            tresorerie: {
                fonds_disponibles: n(fondsMM.fonds_disponibles),
                tresorerie_corrigee: tresorerieCorrigee,
                fond_mis_a_disposition: n(fondMisADisposition),
                perte_ou_excedent: perteOuExcedent
            },
            gaz,
            activite_du_jour: activite
        });
    } catch (err) {
        console.error('Erreur dashboard:', err);
        res.status(500).json({ erreur: 'Erreur serveur dashboard.' });
    }
});

module.exports = router;