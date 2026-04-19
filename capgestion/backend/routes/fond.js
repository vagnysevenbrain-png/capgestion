const express = require('express');
const db      = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');
const router  = express.Router();

// GET /api/fond
router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  try {
    const mm  = await db.query('SELECT * FROM fond_mm WHERE site_id = $1', [siteId]);
    const gaz = await db.query('SELECT * FROM gaz_config WHERE site_id = $1', [siteId]);
    const emp = await db.query('SELECT id, nom, poste, salaire_base FROM employes WHERE site_id = $1 AND actif = TRUE ORDER BY nom', [siteId]);
    res.json({ fond_mm: mm.rows[0]||null, gaz: gaz.rows[0]||null, employes: emp.rows });
  } catch (err) {
    console.error('Erreur fond:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// PUT /api/fond/mm
router.put('/mm', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const { orange_pdv, orange_rev, wave, mtn, moov, moov_p2, tresor, unites, especes } = req.body;
  try {
    await db.query(
  `UPDATE fond_mm SET
     orange_pdv=$1::bigint, orange_rev=$2::bigint, orange_total=$1::bigint+$2::bigint,
     wave=$3::bigint, mtn=$4::bigint, moov=$5::bigint, moov_p2=$6::bigint,
     tresor=$7::bigint, unites=$8::bigint, especes=$9::bigint, mis_a_jour=NOW()
   WHERE site_id=$10`,
  [orange_pdv||0, orange_rev||0, wave||0, mtn||0,
   moov||0, moov_p2||0, tresor||0, unites||0, especes||0, siteId]
);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur MAJ fond:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// PUT /api/fond/gaz — AVANT les routes avec paramètres
router.put('/gaz', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const { b12_pleines, b12_vides, b6_pleines, b6_vides } = req.body;
  try {
 await db.query(
  `UPDATE gaz_config SET
     b12_pleines=$1::int, b12_vides=$2::int, b12_stock=$1::int+$2::int,
     b6_pleines=$3::int,  b6_vides=$4::int,  b6_stock=$3::int+$4::int,
     mis_a_jour=NOW()
   WHERE site_id=$5`,
  [b12_pleines||0, b12_vides||0, b6_pleines||0, b6_vides||0, siteId]
);
    res.json({ ok: true });
  } catch (err) {
    console.error('Erreur MAJ gaz:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// POST /api/fond/mm/commissions — AVANT GET /mm/:mois
router.post('/mm/commissions', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, orange_total, wave, mtn, moov, tresor, unites } = req.body;
  if(!mois) return res.status(400).json({ erreur: 'Mois requis.' });
  const moisDate = mois + '-01';
  try {
    await db.query(
      `INSERT INTO mm_mensuel (site_id, mois, orange_total, wave, mtn, moov, tresor, unites)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (site_id, mois) DO UPDATE SET
         orange_total=EXCLUDED.orange_total, wave=EXCLUDED.wave,
         mtn=EXCLUDED.mtn, moov=EXCLUDED.moov,
         tresor=EXCLUDED.tresor, unites=EXCLUDED.unites`,
      [siteId, moisDate, orange_total||0, wave||0, mtn||0, moov||0, tresor||0, unites||0]
    );
    res.json({ ok: true });
  } catch(err) {
    console.error('Erreur commissions:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /api/fond/mm/:mois — EN DERNIER car contient un paramètre dynamique
router.get('/mm/:mois', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const mois   = req.params.mois + '-01';
  try {
    const result = await db.query(
      'SELECT * FROM mm_mensuel WHERE site_id=$1 AND mois=$2',
      [siteId, mois]
    );
    res.json(result.rows[0]||null);
  } catch(err) {
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /api/fond/employes
router.get('/employes', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  try {
    const result = await db.query(
      'SELECT id, nom, poste, salaire_base FROM employes WHERE site_id=$1 AND actif=TRUE ORDER BY nom',
      [siteId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
