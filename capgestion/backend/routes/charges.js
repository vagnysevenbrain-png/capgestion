const express = require('express');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.round(n);
}

function monthToDate(mois) {
  return `${mois}-01`;
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

async function getSalairesDetail(siteId, moisDate) {
  const result = await db.query(
    `
    SELECT
      sm.id,
      e.id AS employe_id,
      e.nom,
      e.poste,
      sm.mois,
      sm.salaire_base_snapshot,
      sm.bonus,
      sm.retenues,
      sm.salaire_net,
      sm.statut,
      sm.observation,
      sm.updated_at
    FROM salaires_mois sm
    JOIN employes e ON e.id = sm.employe_id
    WHERE e.site_id = $1
      AND sm.mois = $2
    ORDER BY e.nom ASC
    `,
    [siteId, moisDate]
  );

  return result.rows;
}

async function getChargesRow(siteId, moisDate) {
  const result = await db.query(
    `
    SELECT
      site_id,
      mois,
      salaires,
      loyer_local,
      loyer_terrain,
      telephone_internet,
      transport_gerante,
      mairie,
      photocopie,
      tontine,
      sodeci_cie,
      autres_variables,
      commentaire_autres_variables,
      impots,
      cnps,
      aide_magasin,
      bonus,
      updated_at
    FROM charges
    WHERE site_id = $1
      AND mois = $2
    `,
    [siteId, moisDate]
  );

  return result.rows[0] || null;
}

function getAutresChargesFromRow(row) {
  if (!row) return 0;

  return (
    Number(row.loyer_local || 0) +
    Number(row.loyer_terrain || 0) +
    Number(row.sodeci_cie || 0) +
    Number(row.telephone_internet || 0) +
    Number(row.transport_gerante || 0) +
    Number(row.mairie || 0) +
    Number(row.photocopie || 0) +
    Number(row.tontine || 0) +
    Number(row.autres_variables || 0)
  );
}

async function getGainMmMois(siteId, moisDate) {
  const result = await db.query(
    `
    SELECT
      COALESCE(orange_total, 0) +
      COALESCE(wave, 0) +
      COALESCE(mtn, 0) +
      COALESCE(moov, 0) +
      COALESCE(tresor, 0) +
      COALESCE(unites, 0) AS gain_mm
    FROM mm_mensuel
    WHERE site_id = $1
      AND mois = $2
    `,
    [siteId, moisDate]
  );

  return Number(result.rows[0]?.gain_mm || 0);
}

async function getGainGazMois(siteId, moisDate) {
  const result = await db.query(
    `
    SELECT COALESCE(SUM(
      COALESCE(g.b12_vendues, 0) * COALESCE(gc.b12_commission, 0) +
      COALESCE(g.b6_vendues, 0)  * COALESCE(gc.b6_commission, 0)
    ), 0) AS gain_gaz
    FROM rapports r
    JOIN rapport_gaz g ON g.rapport_id = r.id
    JOIN gaz_config gc ON gc.site_id = r.site_id
    WHERE r.site_id = $1
      AND date_trunc('month', r.date_rapport)::date = $2
    `,
    [siteId, moisDate]
  );

  return Number(result.rows[0]?.gain_gaz || 0);
}

function mapChargesToFinance(row, totalSalaires = 0) {
  return {
    salaires: totalSalaires,
    loyer_magasin_principal: Number(row?.loyer_local || 0),
    loyer_magasin_gaz: Number(row?.loyer_terrain || 0),
    eau_electricite: Number(row?.sodeci_cie || 0),
    telephone_internet: Number(row?.telephone_internet || 0),
    carburant: Number(row?.transport_gerante || 0),
    taxe_mairie: Number(row?.mairie || 0),
    photocopie: Number(row?.photocopie || 0),
    tontine: Number(row?.tontine || 0),
    autre_variable: Number(row?.autres_variables || 0),
    commentaire_autre_variable: row?.commentaire_autres_variables || ''
  };
}

async function buildFinanceMois(siteId, moisDate) {
  const [totalSalaires, salaires, chargesRow, gainMm, gainGaz] = await Promise.all([
    getTotalSalairesMois(siteId, moisDate),
    getSalairesDetail(siteId, moisDate),
    getChargesRow(siteId, moisDate),
    getGainMmMois(siteId, moisDate),
    getGainGazMois(siteId, moisDate)
  ]);

  const autresCharges = getAutresChargesFromRow(chargesRow);
  const totalCharges = totalSalaires + autresCharges;
  const beneficeNet = gainMm + gainGaz - totalCharges;

  return {
    mois: moisDate.slice(0, 7),
    salaires,
    charges: mapChargesToFinance(chargesRow, totalSalaires),
    resume: {
      gain_mm: gainMm,
      gain_gaz: gainGaz,
      salaires: totalSalaires,
      autres_charges: autresCharges,
      total_charges: totalCharges,
      benefice_net: beneficeNet
    }
  };
}

/**
 * GET /api/charges/synthese/annuelle?annee=2026
 */
router.get('/synthese/annuelle', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const annee = String(req.query.annee || new Date().getFullYear());

  try {
    const moisList = Array.from({ length: 12 }, (_, i) => {
      const mois = String(i + 1).padStart(2, '0');
      return `${annee}-${mois}-01`;
    });

    const rows = [];
    for (const moisDate of moisList) {
      const finance = await buildFinanceMois(siteId, moisDate);
      rows.push({
        mois: finance.mois,
        gain_mm: finance.resume.gain_mm,
        gain_gaz: finance.resume.gain_gaz,
        salaires: finance.resume.salaires,
        autres_charges: finance.resume.autres_charges,
        total_charges: finance.resume.total_charges,
        benefice_net: finance.resume.benefice_net
      });
    }

    const totalAnnuel = rows.reduce(
      (acc, row) => {
        acc.gain_mm += row.gain_mm;
        acc.gain_gaz += row.gain_gaz;
        acc.salaires += row.salaires;
        acc.autres_charges += row.autres_charges;
        acc.total_charges += row.total_charges;
        acc.benefice_net += row.benefice_net;
        return acc;
      },
      {
        gain_mm: 0,
        gain_gaz: 0,
        salaires: 0,
        autres_charges: 0,
        total_charges: 0,
        benefice_net: 0
      }
    );

    const sortedByBenefice = [...rows].sort((a, b) => b.benefice_net - a.benefice_net);

    res.json({
      annee,
      mois: rows,
      resume_annuel: {
        ...totalAnnuel,
        moyenne_mensuelle_benefice: Number((totalAnnuel.benefice_net / 12).toFixed(2)),
        meilleur_mois: sortedByBenefice[0] || null,
        pire_mois: sortedByBenefice[sortedByBenefice.length - 1] || null
      }
    });
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
  const mois = req.params.mois;

  if (!/^\d{4}-\d{2}$/.test(mois)) {
    return res.status(400).json({ erreur: 'Le mois doit être au format YYYY-MM.' });
  }

  try {
    const finance = await buildFinanceMois(siteId, monthToDate(mois));
    res.json(finance);
  } catch (err) {
    console.error('Erreur lecture charges finance:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * POST /api/charges
 * Enregistre les charges mensuelles simplifiées
 */
router.post('/', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const {
    mois,
    loyer_magasin_principal,
    loyer_magasin_gaz,
    eau_electricite,
    telephone_internet,
    carburant,
    taxe_mairie,
    photocopie,
    tontine,
    autre_variable,
    commentaire_autre_variable
  } = req.body;

  if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
    return res.status(400).json({ erreur: 'Le mois doit être au format YYYY-MM.' });
  }

  const moisDate = monthToDate(mois);

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
        photocopie,
        tontine,
        sodeci_cie,
        autres_variables,
        commentaire_autres_variables,
        impots,
        cnps,
        aide_magasin,
        bonus
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0,0,0
      )
      ON CONFLICT (site_id, mois)
      DO UPDATE SET
        salaires = EXCLUDED.salaires,
        loyer_local = EXCLUDED.loyer_local,
        loyer_terrain = EXCLUDED.loyer_terrain,
        telephone_internet = EXCLUDED.telephone_internet,
        transport_gerante = EXCLUDED.transport_gerante,
        mairie = EXCLUDED.mairie,
        photocopie = EXCLUDED.photocopie,
        tontine = EXCLUDED.tontine,
        sodeci_cie = EXCLUDED.sodeci_cie,
        autres_variables = EXCLUDED.autres_variables,
        commentaire_autres_variables = EXCLUDED.commentaire_autres_variables,
        impots = 0,
        cnps = 0,
        aide_magasin = 0,
        bonus = 0,
        updated_at = NOW()
      `,
      [
        siteId,
        moisDate,
        totalSalaires,
        toPositiveInt(loyer_magasin_principal),
        toPositiveInt(loyer_magasin_gaz),
        toPositiveInt(telephone_internet),
        toPositiveInt(carburant),
        toPositiveInt(taxe_mairie),
        toPositiveInt(photocopie),
        toPositiveInt(tontine),
        toPositiveInt(eau_electricite),
        toPositiveInt(autre_variable),
        commentaire_autre_variable?.trim() || null
      ]
    );

    const finance = await buildFinanceMois(siteId, moisDate);

    res.json({
      ok: true,
      ...finance
    });
  } catch (err) {
    console.error('Erreur sauvegarde charges finance:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;