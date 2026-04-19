const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
const router  = express.Router();

router.post('/', requireAuth, async (req, res) => {
  const siteId   = req.session.siteId;
  const gerantId = req.session.userId;
  const { date_rapport, soldes, gaz, depenses, observation } = req.body;
  if (!date_rapport || !soldes || !gaz) {
    return res.status(400).json({ erreur: 'Données incomplètes.' });
  }
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const rRes = await client.query(
      `INSERT INTO rapports (site_id, gerant_id, date_rapport, observation)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [siteId, gerantId, date_rapport, observation||null]
    );
    const rapportId = rRes.rows[0].id;
    await client.query(
      `INSERT INTO rapport_soldes
         (rapport_id, orange_rev, orange_pdv, wave, mtn, moov, moov_p2, tresor, especes, unites)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [rapportId,
       soldes.orange_rev||0, soldes.orange_pdv||0,
       soldes.wave||0, soldes.mtn||0, soldes.moov||0,
       soldes.moov_p2||0, soldes.tresor||0, soldes.especes||0,
       soldes.unites||0]
    );
    await client.query(
      `INSERT INTO rapport_gaz
         (rapport_id, b12_vendues, b12_rechargees, b12_fuites, b6_vendues, b6_rechargees, b6_fuites)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [rapportId,
       gaz.b12v||0, gaz.b12r||0, gaz.b12f||0,
       gaz.b6v||0,  gaz.b6r||0,  gaz.b6f||0]
    );
    if (depenses && depenses.length > 0) {
      for (const dep of depenses) {
        await client.query(
          'INSERT INTO rapport_depenses (rapport_id, description, montant) VALUES ($1,$2,$3)',
          [dep.description, dep.montant].unshift(rapportId) || [rapportId, dep.description, dep.montant]
        );
      }
    }
    await client.query(
      `UPDATE gaz_config SET
         b12_pleines = b12_pleines + $1::int - $2::int,
         b12_vides   = b12_vides   - $1::int + $2::int,
         b6_pleines  = b6_pleines  + $3::int - $4::int,
         b6_vides    = b6_vides    - $3::int + $4::int,
         b12_stock   = b12_stock   + $1::int - $2::int - $5::int,
         b6_stock    = b6_stock    + $3::int - $4::int - $6::int,
         mis_a_jour  = NOW()
       WHERE site_id = $7`,
      [gaz.b12r||0, gaz.b12v||0, gaz.b6r||0, gaz.b6v||0,
       gaz.b12f||0, gaz.b6f||0, siteId]
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

router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, limit = 31 } = req.query;
  try {
    let query = `
      SELECT r.id, r.date_rapport, r.observation, r.statut, r.created_at,
             u.nom AS gerant_nom,
             s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov,
             s.moov_p2, s.tresor, s.especes, s.unites,
             g.b12_vendues, g.b12_rechargees, g.b12_fuites,
             g.b6_vendues,  g.b6_rechargees,  g.b6_fuites
      FROM rapports r
      JOIN utilisateurs u       ON r.gerant_id  = u.id
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

router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId  = req.session.siteId;
  try {
    const result = await db.query(
      `SELECT r.*, u.nom AS gerant_nom,
              s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov,
              s.moov_p2, s.tresor, s.especes, s.unites,
              g.b12_vendues, g.b12_rechargees, g.b12_fuites,
              g.b6_vendues,  g.b6_rechargees,  g.b6_fuites
       FROM rapports r
       JOIN utilisateurs u       ON r.gerant_id  = u.id
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

router.put('/:id', requireAuth, async (req, res) => {
  const { id }  = req.params;
  const siteId  = req.session.siteId;
  const { soldes, gaz, depenses, observation } = req.body;
  const client  = await db.pool.connect();
  try {
    const check = await client.query(
      'SELECT * FROM rapports WHERE id=$1 AND site_id=$2', [id, siteId]
    );
    if (check.rows.length === 0) {
      return res.status(404).json({ erreur: 'Rapport introuvable.' });
    }
    const rap       = check.rows[0];
    const today     = new Date();
    const rapDate   = new Date(rap.date_rapport);
    const diffJours = Math.floor((today - rapDate) / (1000 * 60 * 60 * 24));
    const limite    = req.session.role === 'proprietaire' ? 7 : 0;
    if (diffJours > limite) {
      return res.status(403).json({
        erreur: req.session.role === 'proprietaire'
          ? 'Modification impossible au-delà de 7 jours.'
          : 'Seul le rapport du jour peut être modifié.'
      });
    }
    await client.query('BEGIN');
    await client.query(
      'UPDATE rapports SET observation=$1 WHERE id=$2', [observation||null, id]
    );
    await client.query(
      `UPDATE rapport_soldes SET
         orange_rev=$1, orange_pdv=$2, wave=$3, mtn=$4,
         moov=$5, moov_p2=$6, tresor=$7, especes=$8, unites=$9
       WHERE rapport_id=$10`,
      [soldes.orange_rev||0, soldes.orange_pdv||0, soldes.wave||0,
       soldes.mtn||0, soldes.moov||0, soldes.moov_p2||0,
       soldes.tresor||0, soldes.especes||0, soldes.unites||0, id]
    );
    await client.query(
      `UPDATE rapport_gaz SET
         b12_vendues=$1, b12_rechargees=$2, b12_fuites=$3,
         b6_vendues=$4,  b6_rechargees=$5,  b6_fuites=$6
       WHERE rapport_id=$7`,
      [gaz.b12v||0, gaz.b12r||0, gaz.b12f||0,
       gaz.b6v||0,  gaz.b6r||0,  gaz.b6f||0, id]
    );
    await client.query(
      'DELETE FROM rapport_depenses WHERE rapport_id=$1', [id]
    );
    if (depenses && depenses.length > 0) {
      for (const dep of depenses) {
        await client.query(
          'INSERT INTO rapport_depenses (rapport_id, description, montant) VALUES ($1,$2,$3)',
          [id, dep.description, dep.montant]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur modification rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

module.exports = router;
