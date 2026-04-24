const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
}

/**
 * GET /api/dashboard
 * Tableau de bord V2
 */
router.get('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const today = new Date().toISOString().slice(0, 10);

    try {
        const [
            fondMmRes,
            comptesClientsRes,
            fondMisADispoRes,
            gazConfigRes,
            caisseGazRes,
            rapportJourRes,
            depensesJourRes
        ] = await Promise.all([
            db.query(
                `
        SELECT *
        FROM fond_mm
        WHERE site_id = $1
        `,
                [siteId]
            ),

            db.query(
                `
        SELECT
          COUNT(*) FILTER (WHERE actif = TRUE AND deleted_at IS NULL) AS comptes_actifs,
          COUNT(*) FILTER (WHERE actif = FALSE AND deleted_at IS NULL) AS comptes_inactifs,
          COALESCE(SUM(CASE WHEN solde_compte > 0 THEN solde_compte ELSE 0 END), 0) AS total_clients_debiteurs,
          COALESCE(SUM(CASE WHEN solde_compte < 0 THEN ABS(solde_compte) ELSE 0 END), 0) AS total_clients_crediteurs,
          COALESCE(SUM(solde_compte), 0) AS solde_net_comptes_clients
        FROM v_comptes_clients_soldes
        WHERE site_id = $1
          AND deleted_at IS NULL
        `,
                [siteId]
            ),

            db.query(
                `
        SELECT fond_mis_a_disposition
        FROM v_fond_mm_mis_a_disposition
        WHERE site_id = $1
        `,
                [siteId]
            ),

            db.query(
                `
        SELECT *
        FROM gaz_config
        WHERE site_id = $1
        `,
                [siteId]
            ),

            db.query(
                `
        SELECT caisse_gaz_theorique
        FROM v_gaz_caisse_theorique
        WHERE site_id = $1
        `,
                [siteId]
            ),

            db.query(
                `
        SELECT
          r.id,
          r.date_rapport,
          r.observation,
          s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov, s.moov_p2, s.tresor, s.especes, s.unites,
          g.b12_vendues, g.b12_rechargees, g.b12_fuites,
          g.b6_vendues, g.b6_rechargees, g.b6_fuites
        FROM rapports r
        LEFT JOIN rapport_soldes s ON s.rapport_id = r.id
        LEFT JOIN rapport_gaz g ON g.rapport_id = r.id
        WHERE r.site_id = $1
          AND r.date_rapport = $2
        LIMIT 1
        `,
                [siteId, today]
            ),

            db.query(
                `
        SELECT COALESCE(SUM(d.montant), 0) AS total_depenses_jour
        FROM rapports r
        JOIN rapport_depenses d ON d.rapport_id = r.id
        WHERE r.site_id = $1
          AND r.date_rapport = $2
        `,
                [siteId, today]
            )
        ]);

        const fondMm = fondMmRes.rows[0] || null;
        const comptesClients = comptesClientsRes.rows[0] || {};
        const fondMisADispo = fondMisADispoRes.rows[0] || { fond_mis_a_disposition: 0 };
        const gazConfig = gazConfigRes.rows[0] || null;
        const caisseGaz = caisseGazRes.rows[0] || { caisse_gaz_theorique: 0 };
        const rapportJour = rapportJourRes.rows[0] || null;
        const depensesJour = depensesJourRes.rows[0] || { total_depenses_jour: 0 };

        const fondsDisponibles = fondMm
            ? toNumber(fondMm.orange_rev) +
            toNumber(fondMm.orange_pdv) +
            toNumber(fondMm.wave) +
            toNumber(fondMm.mtn) +
            toNumber(fondMm.moov) +
            toNumber(fondMm.moov_p2) +
            toNumber(fondMm.tresor) +
            toNumber(fondMm.unites) +
            toNumber(fondMm.especes)
            : 0;

        const totalClientsDebiteurs = toNumber(comptesClients.total_clients_debiteurs);
        const totalClientsCrediteurs = toNumber(comptesClients.total_clients_crediteurs);
        const soldeNetComptesClients = toNumber(comptesClients.solde_net_comptes_clients);

        const tresorerieCorrigee = fondsDisponibles + soldeNetComptesClients;
        const fondMisADisposition = toNumber(fondMisADispo.fond_mis_a_disposition);
        const perteOuExcedent = tresorerieCorrigee - fondMisADisposition;

        let besoinRecharge = 0;
        let commissionGazJour = 0;
        let ventesGazJour = 0;

        if (gazConfig) {
            besoinRecharge =
                toNumber(gazConfig.b12_vides) * toNumber(gazConfig.b12_cout_recharge) +
                toNumber(gazConfig.b6_vides) * toNumber(gazConfig.b6_cout_recharge);

            if (rapportJour) {
                commissionGazJour =
                    toNumber(rapportJour.b12_vendues) * toNumber(gazConfig.b12_commission) +
                    toNumber(rapportJour.b6_vendues) * toNumber(gazConfig.b6_commission);

                ventesGazJour =
                    toNumber(rapportJour.b12_vendues) * toNumber(gazConfig.b12_prix_vente) +
                    toNumber(rapportJour.b6_vendues) * toNumber(gazConfig.b6_prix_vente);
            }
        }

        const caisseGazTheorique = toNumber(caisseGaz.caisse_gaz_theorique);
        const soldeRechargeGaz = caisseGazTheorique - besoinRecharge;

        res.json({
            date_du_jour: today,

            fonds_mm: {
                orange_rev: toNumber(fondMm?.orange_rev),
                orange_pdv: toNumber(fondMm?.orange_pdv),
                orange_total: toNumber(fondMm?.orange_total),
                wave: toNumber(fondMm?.wave),
                mtn: toNumber(fondMm?.mtn),
                moov: toNumber(fondMm?.moov),
                moov_p2: toNumber(fondMm?.moov_p2),
                tresor: toNumber(fondMm?.tresor),
                unites: toNumber(fondMm?.unites),
                especes: toNumber(fondMm?.especes),
                fonds_disponibles: fondsDisponibles
            },

            comptes_clients: {
                comptes_actifs: toNumber(comptesClients.comptes_actifs),
                comptes_inactifs: toNumber(comptesClients.comptes_inactifs),
                total_clients_debiteurs: totalClientsDebiteurs,
                total_clients_crediteurs: totalClientsCrediteurs,
                solde_net_comptes_clients: soldeNetComptesClients
            },

            tresorerie: {
                fonds_disponibles: fondsDisponibles,
                tresorerie_corrigee: tresorerieCorrigee,
                fond_mis_a_disposition: fondMisADisposition,
                perte_ou_excedent: perteOuExcedent
            },

            gaz: {
                b12_pleines: toNumber(gazConfig?.b12_pleines),
                b12_vides: toNumber(gazConfig?.b12_vides),
                b12_stock: toNumber(gazConfig?.b12_stock),
                b6_pleines: toNumber(gazConfig?.b6_pleines),
                b6_vides: toNumber(gazConfig?.b6_vides),
                b6_stock: toNumber(gazConfig?.b6_stock),
                b12_cout_recharge: toNumber(gazConfig?.b12_cout_recharge),
                b6_cout_recharge: toNumber(gazConfig?.b6_cout_recharge),
                besoin_recharge: besoinRecharge,
                caisse_gaz_theorique: caisseGazTheorique,
                solde_recharge_gaz: soldeRechargeGaz
            },

            activite_du_jour: {
                rapport_saisi: !!rapportJour,
                b12_vendues: toNumber(rapportJour?.b12_vendues),
                b12_rechargees: toNumber(rapportJour?.b12_rechargees),
                b12_fuites: toNumber(rapportJour?.b12_fuites),
                b6_vendues: toNumber(rapportJour?.b6_vendues),
                b6_rechargees: toNumber(rapportJour?.b6_rechargees),
                b6_fuites: toNumber(rapportJour?.b6_fuites),
                ventes_gaz_jour: ventesGazJour,
                commission_gaz_jour: commissionGazJour,
                total_depenses_jour: toNumber(depensesJour.total_depenses_jour)
            }
        });
    } catch (err) {
        console.error('Erreur dashboard:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

module.exports = router;