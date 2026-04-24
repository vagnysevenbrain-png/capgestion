const express = require('express');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.round(n);
}

async function getTotalSalairesMois(siteId, moisDate) {
  const result = await db.query(
    `
    SELECT COALESCE(SUM(sm.salaire_net), 0) AS total_salaires
    FROM salaires_mois sm
    JOIN employes e ON e.id = sm.employe_id
    WHERE e.site_id = $1
      AND sm.mois = $2
    `,
    [siteId, moisDate]
  );

  return Number(result.rows[0]?.total_salaires || 0);
}

/**
 * GET /api/charges/synthese/annuelle?annee=2026
 */
router.get('/synthese/annuelle', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const annee = req.query.annee || new Date().getFullYear();

  try {
    const result = await db.query(
      `
      SELECT
        to_char(m.mois, 'YYYY-MM') AS mois,

        COALESCE((
          SELECT
            COALESCE(mm.orange_total, 0) +
            COALESCE(mm.wave, 0) +
            COALESCE(mm.mtn, 0) +
            COALESCE(mm.moov, 0) +
            COALESCE(mm.tresor, 0) +
            COALESCE(mm.unites, 0)
          FROM mm_mensuel mm
          WHERE mm.site_id = $1
            AND mm.mois = m.mois
        ), 0) AS gain_mm,

        COALESCE((
          SELECT SUM(
            COALESCE(g.b12_vendues, 0) * gc.b12_commission +
            COALESCE(g.b6_vendues, 0)  * gc.b6_commission
          )
          FROM rapport_gaz g
          JOIN rapports r ON g.rapport_id = r.id
          JOIN gaz_config gc ON gc.site_id = r.site_id
          WHERE r.site_id = $1
            AND date_trunc('month', r.date_rapport)::date = m.mois
        ), 0) AS gain_gaz,

        COALESCE((
          SELECT
            COALESCE(c.salaires, 0) +
            COALESCE(c.loyer_local, 0) +
            COALESCE(c.loyer_terrain, 0) +
            COALESCE(c.telephone_internet, 0) +
            COALESCE(c.transport_gerante, 0) +
            COALESCE(c.mairie, 0) +
            COALESCE(c.impots, 0) +
            COALESCE(c.cnps, 0) +
            COALESCE(c.photocopie, 0) +
            COALESCE(c.tontine, 0) +
            COALESCE(c.sodeci_cie, 0) +
            COALESCE(c.aide_magasin, 0) +
            COALESCE(c.bonus, 0) +
            COALESCE(c.autres_variables, 0)
          FROM charges c
          WHERE c.site_id = $1
            AND c.mois = m.mois
        ), 0) AS total_charges

      FROM generate_series(
        ($2::text || '-01-01')::date,
        ($2::text || '-12-01')::date,
        '1 month'::interval
      ) AS m(mois)
      ORDER BY m.mois
      `,
      [siteId, annee]
    );

    res.json(result.rows);
  } catch (err) {
    console.error('Erreur synthèse annuelle charges:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * GET /api/charges/:mois
 * :mois = YYYY-MM
 */
router.get('/:mois', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const moisDate = `${req.params.mois}-01`;

  try {
    const chargesRes = await db.query(
      `
      SELECT *
      FROM charges
      WHERE site_id = $1
        AND mois = $2
      `,
      [siteId, moisDate]
    );

    const salairesRes = await db.query(
      `
      SELECT
        sm.id,
        e.id AS employe_id,
        e.nom,
        e.poste,
        sm.salaire_base_snapshot,
        sm.bonus,
        sm.retenues,
        sm.salaire_net,
        sm.statut,
        sm.observation
      FROM salaires_mois sm
      JOIN employes e ON e.id = sm.employe_id
      WHERE e.site_id = $1
        AND sm.mois = $2
      ORDER BY e.nom ASC
      `,
      [siteId, moisDate]
    );

    const totalSalaires = await getTotalSalairesMois(siteId, moisDate);

    res.json({
      charges: chargesRes.rows[0] || null,
      salaires: salairesRes.rows,
      total_salaires: totalSalaires
    });
  } catch (err) {
    console.error('Erreur lecture charges:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * POST /api/charges
 * Enregistre les charges du mois
 * Le champ salaires est calculé automatiquement depuis salaires_mois
 */
router.post('/', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, ...champs } = req.body;

  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
    return res.status(400).json({ erreur: 'Le mois doit être au format YYYY-MM.' });
  }

  const moisDate = `${mois}-01`;

  try {
    const totalSalaires = await getTotalSalairesMois(siteId, moisDate);

    await db.query(
      `
      INSERT INTO charges (
        site_id,
        mois,
        salaires,
        loyer_local,
        loyer_terrain,
        telephone_internet,
        transport_gerante,
        mairie,
        impots,
        cnps,
        photocopie,
        tontine,
        sodeci_cie,
        aide_magasin,
        bonus,
        autres_variables
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16
      )
      ON CONFLICT (site_id, mois)
      DO UPDATE SET
        salaires = EXCLUDED.salaires,
        loyer_local = EXCLUDED.loyer_local,
        loyer_terrain = EXCLUDED.loyer_terrain,
        telephone_internet = EXCLUDED.telephone_internet,
        transport_gerante = EXCLUDED.transport_gerante,
        mairie = EXCLUDED.mairie,
        impots = EXCLUDED.impots,
        cnps = EXCLUDED.cnps,
        photocopie = EXCLUDED.photocopie,
        tontine = EXCLUDED.tontine,
        sodeci_cie = EXCLUDED.sodeci_cie,
        aide_magasin = EXCLUDED.aide_magasin,
        bonus = EXCLUDED.bonus,
        autres_variables = EXCLUDED.autres_variables,
        updated_at = NOW()
      `,
      [
        siteId,
        moisDate,
        totalSalaires,
        toPositiveInt(champs.loyer_local),
        toPositiveInt(champs.loyer_terrain),
        toPositiveInt(champs.telephone_internet),
        toPositiveInt(champs.transport_gerante),
        toPositiveInt(champs.mairie),
        toPositiveInt(champs.impots),
        toPositiveInt(champs.cnps),
        toPositiveInt(champs.photocopie),
        toPositiveInt(champs.tontine),
        toPositiveInt(champs.sodeci_cie),
        toPositiveInt(champs.aide_magasin),
        toPositiveInt(champs.bonus),
        toPositiveInt(champs.autres_variables)
      ]
    );

    res.json({
      ok: true,
      mois,
      salaires_calcules: totalSalaires
    });
  } catch (err) {
    console.error('Erreur sauvegarde charges:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;