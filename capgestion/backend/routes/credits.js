const express = require('express');
const db      = require('../db');
const { requireAuth } = require('../middleware/auth');
const router  = express.Router();

// GET /api/credits — liste
router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const { statut } = req.query;
  try {
    let query = `SELECT * FROM credits WHERE site_id = $1`;
    const params = [siteId];
    if (statut) { params.push(statut); query += ` AND statut = $2`; }
    query += ` ORDER BY created_at DESC`;
    const result = await db.query(query, params);

    for (const c of result.rows) {
      const mvts = await db.query(
        `SELECT type_mvt, montant, mode_paiement, note,
                to_char(created_at,'DD/MM/YYYY') AS date
         FROM credit_mouvements WHERE credit_id = $1 ORDER BY created_at`,
        [c.id]
      );
      c.mouvements = mvts.rows;
    }
    res.json(result.rows);
  } catch (err) {
    console.error('Erreur crédits:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// POST /api/credits — nouveau crédit
router.post('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const { nom, telephone, operateur, montant, echeance, observation } = req.body;
  if (!nom || !montant) return res.status(400).json({ erreur: 'Nom et montant requis.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cRes = await client.query(
      `INSERT INTO credits (site_id, nom, telephone, operateur, montant, echeance, observation)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [siteId, nom, telephone || null, operateur || null,
       montant, echeance || null, observation || null]
    );
    const creditId = cRes.rows[0].id;
    await client.query(
      `INSERT INTO credit_mouvements (credit_id, type_mvt, montant, note)
       VALUES ($1,'credit',$2,'Crédit accordé')`,
      [creditId, montant]
    );
    await client.query('COMMIT');
    res.json({ ok: true, credit_id: creditId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur crédit:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

// POST /api/credits/:id/remboursement
router.post('/:id/remboursement', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId  = req.session.siteId;
  const { montant, mode_paiement, note } = req.body;
  if (!montant || montant <= 0) return res.status(400).json({ erreur: 'Montant invalide.' });
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const cRes = await client.query(
      'SELECT * FROM credits WHERE id = $1 AND site_id = $2', [id, siteId]
    );
    if (cRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ erreur: 'Crédit introuvable.' });
    }
    const credit   = cRes.rows[0];
    const nouveau  = Math.min(credit.montant, credit.rembourse + montant);
    const solde    = nouveau >= credit.montant;
    await client.query(
      `UPDATE credits SET rembourse = $1, statut = $2 WHERE id = $3`,
      [nouveau, solde ? 'solde' : 'en_cours', id]
    );
    await client.query(
      `INSERT INTO credit_mouvements (credit_id, type_mvt, montant, mode_paiement, note)
       VALUES ($1,'remb',$2,$3,$4)`,
      [id, montant, mode_paiement || null, note || null]
    );
    await client.query('COMMIT');
    res.json({ ok: true, solde, nouveau_remboursement: nouveau });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur remboursement:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

module.exports = router;
