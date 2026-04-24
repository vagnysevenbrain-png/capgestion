const express = require('express');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function toNonNegativeInt(value, defaultValue = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.round(n);
}

/**
 * GET /api/fond
 * Retourne l'état général des fonds et du gaz
 */
router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;

  try {
    const [
      fondMmRes,
      fondMisADispoRes,
      fondMouvementsRes,
      gazConfigRes,
      gazCaisseRes,
      gazMouvementsRes
    ] = await Promise.all([
      db.query(
        `SELECT * FROM fond_mm WHERE site_id = $1`,
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
        SELECT
          id,
          date_mouvement,
          type_mvt,
          montant,
          motif,
          cree_par,
          created_at
        FROM fond_mm_proprietaire_mouvements
        WHERE site_id = $1
        ORDER BY date_mouvement DESC, id DESC
        LIMIT 20
        `,
        [siteId]
      ),

      db.query(
        `SELECT * FROM gaz_config WHERE site_id = $1`,
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
          id,
          date_mouvement,
          type_mvt,
          montant,
          note,
          cree_par,
          created_at
        FROM gaz_caisse_mouvements
        WHERE site_id = $1
        ORDER BY date_mouvement DESC, id DESC
        LIMIT 20
        `,
        [siteId]
      )
    ]);

    res.json({
      fond_mm: fondMmRes.rows[0] || null,
      fond_mis_a_disposition: Number(
        fondMisADispoRes.rows[0]?.fond_mis_a_disposition || 0
      ),
      mouvements_fond_mis_a_disposition: fondMouvementsRes.rows,
      gaz: gazConfigRes.rows[0] || null,
      caisse_gaz_theorique: Number(
        gazCaisseRes.rows[0]?.caisse_gaz_theorique || 0
      ),
      mouvements_caisse_gaz: gazMouvementsRes.rows
    });
  } catch (err) {
    console.error('Erreur lecture fond/gaz:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * PUT /api/fond/mm
 * Met à jour les fonds MM visibles
 * Réservé au propriétaire
 */
router.put('/mm', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;

  const orange_pdv = toNonNegativeInt(req.body.orange_pdv);
  const orange_rev = toNonNegativeInt(req.body.orange_rev);
  const wave = toNonNegativeInt(req.body.wave);
  const mtn = toNonNegativeInt(req.body.mtn);
  const moov = toNonNegativeInt(req.body.moov);
  const moov_p2 = toNonNegativeInt(req.body.moov_p2);
  const tresor = toNonNegativeInt(req.body.tresor);
  const unites = toNonNegativeInt(req.body.unites);
  const especes = toNonNegativeInt(req.body.especes);
  const orange_total = orange_pdv + orange_rev;

  try {
    const result = await db.query(
      `
      UPDATE fond_mm
      SET
        orange_pdv = $1,
        orange_rev = $2,
        orange_total = $3,
        wave = $4,
        mtn = $5,
        moov = $6,
        moov_p2 = $7,
        tresor = $8,
        unites = $9,
        especes = $10,
        mis_a_jour = NOW()
      WHERE site_id = $11
      RETURNING *
      `,
      [
        orange_pdv,
        orange_rev,
        orange_total,
        wave,
        mtn,
        moov,
        moov_p2,
        tresor,
        unites,
        especes,
        siteId
      ]
    );

    res.json({
      ok: true,
      fond_mm: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur mise à jour fond MM:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * GET /api/fond/mise-a-disposition
 * Solde + historique du fond mis à disposition
 */
router.get('/mise-a-disposition', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;

  try {
    const [soldeRes, mouvementsRes] = await Promise.all([
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
        SELECT
          id,
          date_mouvement,
          type_mvt,
          montant,
          motif,
          cree_par,
          created_at
        FROM fond_mm_proprietaire_mouvements
        WHERE site_id = $1
        ORDER BY date_mouvement DESC, id DESC
        LIMIT 50
        `,
        [siteId]
      )
    ]);

    res.json({
      fond_mis_a_disposition: Number(
        soldeRes.rows[0]?.fond_mis_a_disposition || 0
      ),
      mouvements: mouvementsRes.rows
    });
  } catch (err) {
    console.error('Erreur lecture mise à disposition:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * POST /api/fond/mise-a-disposition
 * Ajoute un appro ou retrait
 * Réservé au propriétaire
 */
router.post('/mise-a-disposition', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;
  const userId = req.session.userId;
  const { type_mvt, montant, motif } = req.body;

  if (!['appro', 'retrait'].includes(type_mvt)) {
    return res.status(400).json({ erreur: 'Type invalide. Utiliser appro ou retrait.' });
  }

  const montantNum = toNonNegativeInt(montant, 0);
  if (montantNum <= 0) {
    return res.status(400).json({ erreur: 'Montant invalide.' });
  }

  try {
    await db.query(
      `
      INSERT INTO fond_mm_proprietaire_mouvements (
        site_id,
        date_mouvement,
        type_mvt,
        montant,
        motif,
        cree_par
      )
      VALUES ($1, NOW(), $2, $3, $4, $5)
      `,
      [siteId, type_mvt, montantNum, motif?.trim() || null, userId]
    );

    const soldeRes = await db.query(
      `
      SELECT fond_mis_a_disposition
      FROM v_fond_mm_mis_a_disposition
      WHERE site_id = $1
      `,
      [siteId]
    );

    res.json({
      ok: true,
      fond_mis_a_disposition: Number(
        soldeRes.rows[0]?.fond_mis_a_disposition || 0
      )
    });
  } catch (err) {
    console.error('Erreur mouvement fond mis à disposition:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * PUT /api/fond/gaz
 * Met à jour les stocks/config gaz
 * Réservé au propriétaire
 */
router.put('/gaz', requireAuth, requireProprietaire, async (req, res) => {
  const siteId = req.session.siteId;

  const b12_pleines = toNonNegativeInt(req.body.b12_pleines);
  const b12_vides = toNonNegativeInt(req.body.b12_vides);
  const b6_pleines = toNonNegativeInt(req.body.b6_pleines);
  const b6_vides = toNonNegativeInt(req.body.b6_vides);

  const b12_commission = toNonNegativeInt(req.body.b12_commission, 450);
  const b6_commission = toNonNegativeInt(req.body.b6_commission, 350);
  const b12_prix_vente = toNonNegativeInt(req.body.b12_prix_vente, 4950);
  const b6_prix_vente = toNonNegativeInt(req.body.b6_prix_vente, 1850);
  const b12_cout_recharge = toNonNegativeInt(req.body.b12_cout_recharge, 4850);
  const b6_cout_recharge = toNonNegativeInt(req.body.b6_cout_recharge, 1850);

  const b12_stock = b12_pleines + b12_vides;
  const b6_stock = b6_pleines + b6_vides;

  try {
    const result = await db.query(
      `
      UPDATE gaz_config
      SET
        b12_pleines = $1,
        b12_vides = $2,
        b12_stock = $3,
        b6_pleines = $4,
        b6_vides = $5,
        b6_stock = $6,
        b12_commission = $7,
        b6_commission = $8,
        b12_prix_vente = $9,
        b6_prix_vente = $10,
        b12_cout_recharge = $11,
        b6_cout_recharge = $12,
        mis_a_jour = NOW()
      WHERE site_id = $13
      RETURNING *
      `,
      [
        b12_pleines,
        b12_vides,
        b12_stock,
        b6_pleines,
        b6_vides,
        b6_stock,
        b12_commission,
        b6_commission,
        b12_prix_vente,
        b6_prix_vente,
        b12_cout_recharge,
        b6_cout_recharge,
        siteId
      ]
    );

    res.json({
      ok: true,
      gaz: result.rows[0]
    });
  } catch (err) {
    console.error('Erreur mise à jour gaz:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * GET /api/fond/gaz/caisse
 * Lit la caisse gaz théorique + historique
 */
router.get('/gaz/caisse', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;

  try {
    const [soldeRes, mouvementsRes] = await Promise.all([
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
          id,
          date_mouvement,
          type_mvt,
          montant,
          note,
          cree_par,
          created_at
        FROM gaz_caisse_mouvements
        WHERE site_id = $1
        ORDER BY date_mouvement DESC, id DESC
        LIMIT 50
        `,
        [siteId]
      )
    ]);

    res.json({
      caisse_gaz_theorique: Number(
        soldeRes.rows[0]?.caisse_gaz_theorique || 0
      ),
      mouvements: mouvementsRes.rows
    });
  } catch (err) {
    console.error('Erreur lecture caisse gaz:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * POST /api/fond/gaz/caisse
 * Ajoute un mouvement de caisse gaz
 * appro/retrait réservés au propriétaire
 */
router.post('/gaz/caisse', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const userId = req.session.userId;
  const role = req.session.role;
  const { type_mvt, montant, note } = req.body;

  const typesAutorises = [
    'vente',
    'recharge',
    'depense',
    'ajustement_plus',
    'ajustement_moins',
    'appro',
    'retrait'
  ];

  if (!typesAutorises.includes(type_mvt)) {
    return res.status(400).json({ erreur: 'Type de mouvement gaz invalide.' });
  }

  if ((type_mvt === 'appro' || type_mvt === 'retrait') && role !== 'proprietaire') {
    return res.status(403).json({ erreur: 'Seul le propriétaire peut faire appro/retrait sur la caisse gaz.' });
  }

  const montantNum = toNonNegativeInt(montant, 0);
  if (montantNum <= 0) {
    return res.status(400).json({ erreur: 'Montant invalide.' });
  }

  try {
    await db.query(
      `
      INSERT INTO gaz_caisse_mouvements (
        site_id,
        date_mouvement,
        type_mvt,
        montant,
        note,
        cree_par
      )
      VALUES ($1, NOW(), $2, $3, $4, $5)
      `,
      [siteId, type_mvt, montantNum, note?.trim() || null, userId]
    );

    const soldeRes = await db.query(
      `
      SELECT caisse_gaz_theorique
      FROM v_gaz_caisse_theorique
      WHERE site_id = $1
      `,
      [siteId]
    );

    res.json({
      ok: true,
      caisse_gaz_theorique: Number(
        soldeRes.rows[0]?.caisse_gaz_theorique || 0
      )
    });
  } catch (err) {
    console.error('Erreur mouvement caisse gaz:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;