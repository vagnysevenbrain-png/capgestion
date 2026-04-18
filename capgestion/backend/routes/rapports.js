const express = require('express');
const db      = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');
const router  = express.Router();

// POST /api/rapports — créer rapport du jour
router.post('/', requireAuth, async (req, res) => {
  const siteId   = req.session.siteId;
  const gerantId = req.session.userId;
  const { date_rapport, soldes, gaz, depenses, remboursement, remb_client, observation } = req.body;

  if (!date_rapport || !soldes || !gaz) {
    return res.status(400).json({ erreur: 'Données incomplètes.' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    // Insérer rapport principal
    const rRes = await client.query(
      `INSERT INTO rapports (site_id, gerant_id, date_rapport, observation)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [siteId, gerantId, date_rapport, observation || null]
    );
    const rapportId = rRes.rows[0].id;

    // Soldes MM
    await client.query(
      `INSERT INTO rapport_soldes
         (rapport_id, orange_rev, orange_pdv, wave, mtn, moov, tresor, especes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [rapportId,
       soldes.orange_rev || 0, soldes.orange_pdv || 0,
       soldes.wave || 0, soldes.mtn || 0, soldes.moov || 0,
       soldes.tresor || 0, soldes.especes || 0]
    );

    // Gaz
    await client.query(
      `INSERT INTO rapport_gaz
         (rapport_id, b12_vendues, b12_rechargees, b12_fuites, b6_vendues, b6_rechargees, b6_fuites)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rapportId,
       gaz.b12v || 0, gaz.b12r || 0, gaz.b12f || 0,
       gaz.b6v  || 0, gaz.b6r  || 0, gaz.b6f  || 0]
    );

    // Dépenses
    if (depenses && depenses.length > 0) {
      for (const dep of depenses) {
        await client.query(
          'INSERT INTO rapport_depenses (rapport_id, description, montant) VALUES ($1,$2,$3)',
          [rapportId, dep.description, dep.montant]
        );
      }
    }

    // Mettre à jour stock gaz
    await client.query(
      `UPDATE gaz_config SET
         b12_stock = b12_stock + $1 - $2 - $3,
         b6_stock  = b6_stock  + $4 - $5 - $6,
         mis_a_jour = NOW()
       WHERE site_id = $7`,
      [gaz.b12r || 0, gaz.b12v || 0, gaz.b12f || 0,
       gaz.b6r  || 0, gaz.b6v  || 0, gaz.b6f  || 0, siteId]
    );

    await client.query('COMMIT');
    res.json({ ok: true, rapport_id: rapportId });
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '23505') {
      return res.status(409).json({ erreur: 'Un rapport existe déjà pour cette date.' });
    }
    console.error('Erreur création rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// GET /api/rapports — liste des rapports (avec filtres)
router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, limit = 30 } = req.query;
  try {
    let query = `
      SELECT r.id, r.date_rapport, r.observation, r.statut, r.created_at,
             u.nom AS gerant_nom,
             s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov, s.tresor, s.especes,
             g.b12_vendues, g.b12_rechargees, g.b12_fuites,
             g.b6_vendues,  g.b6_rechargees,  g.b6_fuites
      FROM rapports r
      JOIN utilisateurs u    ON r.gerant_id  = u.id
      LEFT JOIN rapport_soldes s ON s.rapport_id = r.id
      LEFT JOIN rapport_gaz    g ON g.rapport_id = r.id
      WHERE r.site_id = $1`;
    const params = [siteId];
    if (mois) {
      params.push(mois);
      query += ` AND to_char(r.date_rapport,'YYYY-MM') = $${params.length}`;
    }
    query += ` ORDER BY r.date_rapport DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));
    const result = await db.query(query, params);

    // Charger les dépenses pour chaque rapport
    const rapports = result.rows;
    for (const r of rapports) {
      const deps = await db.query(
        'SELECT description, montant FROM rapport_depenses WHERE rapport_id = $1',
        [r.id]
      );
      r.depenses = deps.rows;
    }
    res.json(rapports);
  } catch (err) {
    console.error('Erreur liste rapports:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// GET /api/rapports/:id — détail d'un rapport
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId  = req.session.siteId;
  try {
    const result = await db.query(
      `SELECT r.*, u.nom AS gerant_nom,
              s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov, s.tresor, s.especes,
              g.b12_vendues, g.b12_rechargees, g.b12_fuites,
              g.b6_vendues,  g.b6_rechargees,  g.b6_fuites
       FROM rapports r
       JOIN utilisateurs u    ON r.gerant_id  = u.id
       LEFT JOIN rapport_soldes s ON s.rapport_id = r.id
       LEFT JOIN rapport_gaz    g ON g.rapport_id = r.id
       WHERE r.id = $1 AND r.site_id = $2`,
      [id, siteId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ erreur: 'Rapport introuvable.' });
    }
    const rapport = result.rows[0];
    const deps = await db.query(
      'SELECT description, montant FROM rapport_depenses WHERE rapport_id = $1', [id]
    );
    rapport.depenses = deps.rows;
    res.json(rapport);
  } catch (err) {
    console.error('Erreur rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

module.exports = router;
