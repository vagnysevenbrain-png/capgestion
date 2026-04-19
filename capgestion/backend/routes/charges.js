const express = require('express');
const db      = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');
const router  = express.Router();

router.get('/:mois', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const mois   = req.params.mois + '-01';
  try {
    const result = await db.query(
      'SELECT * FROM charges WHERE site_id = $1 AND mois = $2', [siteId, mois]
    );
    const salaires = await db.query(
      `SELECT e.nom, e.poste, sm.salaire, sm.bonus, sm.statut
       FROM salaires_mois sm
       JOIN employes e ON sm.employe_id = e.id
       WHERE e.site_id = $1 AND sm.mois = $2 ORDER BY e.nom`,
      [siteId, mois]
    );
    res.json({ charges: result.rows[0]||null, salaires: salaires.rows });
  } catch (err) {
    console.error('Erreur charges:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

router.post('/', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, ...champs } = req.body;
  if (!mois) return res.status(400).json({ erreur: 'Mois requis.' });
  const moisDate = mois + '-01';
  try {
    await db.query(
      `INSERT INTO charges (site_id, mois,
         salaires, loyer_local, loyer_terrain, telephone_internet,
         transport_gerante, mairie, impots, cnps, photocopie,
         tontine, sodeci_cie, aide_magasin, bonus, autres_variables)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (site_id, mois) DO UPDATE SET
         salaires=EXCLUDED.salaires, loyer_local=EXCLUDED.loyer_local,
         loyer_terrain=EXCLUDED.loyer_terrain,
         telephone_internet=EXCLUDED.telephone_internet,
         transport_gerante=EXCLUDED.transport_gerante,
         mairie=EXCLUDED.mairie, impots=EXCLUDED.impots,
         cnps=EXCLUDED.cnps, photocopie=EXCLUDED.photocopie,
         tontine=EXCLUDED.tontine, sodeci_cie=EXCLUDED.sodeci_cie,
         aide_magasin=EXCLUDED.aide_magasin, bonus=EXCLUDED.bonus,
         autres_variables=EXCLUDED.autres_variables`,
      [siteId, moisDate,
       champs.salaires||0, champs.loyer_local||0, champs.loyer_terrain||0,
       champs.telephone_internet||0, champs.transport_gerante||0,
       champs.mairie||0, champs.impots||0, champs.cnps||0,
       champs.photocopie||0, champs.tontine||0, champs.sodeci_cie||0,
       champs.aide_magasin||0, champs.bonus||0, champs.autres_variables||0]
    );
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur sauvegarde charges:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

router.get('/synthese/annuelle', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const annee  = req.query.annee || new Date().getFullYear();
  try {
    const result = await db.query(
      `SELECT
         to_char(m.mois, 'YYYY-MM') AS mois,
         COALESCE((
  SELECT mm.gain_gaz
  FROM mm_mensuel mm
  WHERE mm.site_id = $1
    AND mm.mois = m.mois
), COALESCE((
  SELECT SUM(
    COALESCE(g.b12_vendues,0) * gc.b12_commission +
    COALESCE(g.b6_vendues,0)  * gc.b6_commission
  )
  FROM rapport_gaz g
  JOIN rapports r ON g.rapport_id = r.id
  CROSS JOIN gaz_config gc
  WHERE r.site_id = $1
    AND gc.site_id = $1
    AND to_char(r.date_rapport,'YYYY-MM') = to_char(m.mois,'YYYY-MM')
), 0)) AS gain_gaz,
        COALESCE((
  SELECT
    COALESCE(mm.orange_total,0) + COALESCE(mm.wave,0) +
    COALESCE(mm.mtn,0) + COALESCE(mm.moov,0) +
    COALESCE(mm.tresor,0) + COALESCE(mm.unites,0)
  FROM mm_mensuel mm
  WHERE mm.site_id = $1
    AND mm.mois = m.mois
), 0) AS gain_mm,
         COALESCE((
           SELECT
             COALESCE(c.salaires,0) + COALESCE(c.loyer_local,0) +
             COALESCE(c.loyer_terrain,0) + COALESCE(c.telephone_internet,0) +
             COALESCE(c.transport_gerante,0) + COALESCE(c.mairie,0) +
             COALESCE(c.impots,0) + COALESCE(c.cnps,0) +
             COALESCE(c.photocopie,0) + COALESCE(c.tontine,0) +
             COALESCE(c.sodeci_cie,0) + COALESCE(c.aide_magasin,0) +
             COALESCE(c.bonus,0) + COALESCE(c.autres_variables,0)
           FROM charges c
           WHERE c.site_id = $1
             AND c.mois = m.mois
         ), 0) AS total_charges
       FROM generate_series(
         ($2::text || '-01-01')::date,
         ($2::text || '-12-01')::date,
         '1 month'::interval
       ) AS m(mois)
       ORDER BY m.mois`,
      [siteId, annee]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur synthèse:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
