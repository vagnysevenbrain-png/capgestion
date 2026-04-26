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

async function getLatestRapport(siteId) {
    const result = await db.query(
        `
    SELECT
      r.id,
      r.site_id,
      r.date_rapport,
      r.observation,
      r.gerant_id,

      rs.orange_rev,
      rs.orange_pdv,
      rs.wave,
      rs.mtn,
      rs.moov,
      rs.moov_p2,
      rs.tresor,
      rs.unites,
      rs.especes,

      rg.b12_vendues,
      rg.b12_rechargees,
      rg.b12_fuites,
      rg.b6_vendues,
      rg.b6_rechargees,
      rg.b6_fuites,
      rg.ventes_gaz_jour,
      rg.commission_gaz_jour,
      rg.caisse_gaz_disponible
    FROM rapports r
    LEFT JOIN rapport_soldes rs
      ON rs.rapport_id = r.id
    LEFT JOIN rapport_gaz rg
      ON rg.rapport_id = r.id
    WHERE r.site_id = $1
    ORDER BY r.date_rapport DESC, r.id DESC
    LIMIT 1
    `,
        [siteId]
    );

    return result.rows[0] || null;
}

async function getFallbackFondMM(siteId) {
    const result = await db.query(
        `
    SELECT
      orange_rev,
      orange_pdv,
      wave,
      mtn,
      moov,
      moov_p2,
      tresor,
      unites,
      especes
    FROM fond_mm
    WHERE site_id = $1
    ORDER BY updated_at DESC
    LIMIT 1
    `,
        [siteId]
    );

    return result.rows[0] || null;
}

async function getGazConfig(siteId) {
    const result = await db.query(
        `
    SELECT
      site_id,
      b12_pleines,
      b12_vides,
      b6_pleines,
      b6_vides,
      b12_commission,
      b6_commission,
      b12_prix_vente,
      b6_prix_vente,
      b12_cout_recharge,
      b6_cout_recharge
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
        const [
            latestRapport,
            fallbackFond,
            gazConfig,
            comptesClients,
            fondMisADisposition
        ] = await Promise.all([
            getLatestRapport(siteId),
            getFallbackFondMM(siteId),
            getGazConfig(siteId),
            getComptesClientsStats(siteId),
            getFondMisADisposition(siteId)
        ]);

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

        if (latestRapport) {
            const orangeRev = n(latestRapport.orange_rev);
            const orangePdv = n(latestRapport.orange_pdv);
            const orangeTotal = orangeRev + orangePdv;
            const wave = n(latestRapport.wave);
            const mtn = n(latestRapport.mtn);
            const moov = n(latestRapport.moov);
            const moovP2 = n(latestRapport.moov_p2);
            const tresor = n(latestRapport.tresor);
            const unites = n(latestRapport.unites);
            const especes = n(latestRapport.especes);

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
            const orangeRev = n(fallbackFond.orange_rev);
            const orangePdv = n(fallbackFond.orange_pdv);
            const orangeTotal = orangeRev + orangePdv;
            const wave = n(fallbackFond.wave);
            const mtn = n(fallbackFond.mtn);
            const moov = n(fallbackFond.moov);
            const moovP2 = n(fallbackFond.moov_p2);
            const tresor = n(fallbackFond.tresor);
            const unites = n(fallbackFond.unites);
            const especes = n(fallbackFond.especes);

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

        const gaz = {
            b12_pleines: n(gazConfig?.b12_pleines),
            b12_vides: n(gazConfig?.b12_vides),
            b12_stock: n(gazConfig?.b12_pleines) + n(gazConfig?.b12_vides),
            b6_pleines: n(gazConfig?.b6_pleines),
            b6_vides: n(gazConfig?.b6_vides),
            b6_stock: n(gazConfig?.b6_pleines) + n(gazConfig?.b6_vides),
            b12_cout_recharge: n(gazConfig?.b12_cout_recharge),
            b6_cout_recharge: n(gazConfig?.b6_cout_recharge),
            caisse_theorique_gaz:
                (n(gazConfig?.b12_vides) * n(gazConfig?.b12_cout_recharge)) +
                (n(gazConfig?.b6_vides) * n(gazConfig?.b6_cout_recharge))
        };

        const activite = {
            rapport_saisi: !!latestRapport,
            date_rapport_reference: isoDate(latestRapport?.date_rapport),
            b12_vendues: n(latestRapport?.b12_vendues),
            b12_rechargees: n(latestRapport?.b12_rechargees),
            b12_fuites: n(latestRapport?.b12_fuites),
            b6_vendues: n(latestRapport?.b6_vendues),
            b6_rechargees: n(latestRapport?.b6_rechargees),
            b6_fuites: n(latestRapport?.b6_fuites),
            ventes_gaz_jour: n(latestRapport?.ventes_gaz_jour),
            commission_gaz_jour: n(latestRapport?.commission_gaz_jour),
            caisse_gaz_disponible: n(latestRapport?.caisse_gaz_disponible),
            ecart_caisse_gaz: n(latestRapport?.caisse_gaz_disponible) - gaz.caisse_theorique_gaz,
            total_depenses_jour: 0
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