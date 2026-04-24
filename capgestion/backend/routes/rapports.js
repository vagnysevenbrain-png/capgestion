const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.round(n);
}

function getGerantDeadline(dateRapport) {
  const d = new Date(dateRapport);
  d.setDate(d.getDate() + 2);
  d.setHours(23, 59, 59, 999);
  return d;
}

function getProprietaireDeadline(dateRapport) {
  const d = new Date(dateRapport);
  return new Date(d.getFullYear(), d.getMonth() + 1, 5, 23, 59, 59, 999);
}

function verifierDroitModification(rapport, session) {
  const now = new Date();
  const dateRapport = new Date(rapport.date_rapport);

  if (session.role === 'gerant') {
    if (Number(rapport.gerant_id) !== Number(session.userId)) {
      return {
        ok: false,
        erreur: 'Vous ne pouvez modifier que vos propres rapports.'
      };
    }

    const deadline = getGerantDeadline(dateRapport);
    if (now > deadline) {
      return {
        ok: false,
        erreur: 'Modification impossible au-delà de 48h après la date du rapport.'
      };
    }

    return { ok: true };
  }

  if (session.role === 'proprietaire') {
    const deadline = getProprietaireDeadline(dateRapport);
    if (now > deadline) {
      return {
        ok: false,
        erreur: 'Modification impossible après le 5 du mois suivant.'
      };
    }

    return { ok: true };
  }

  return {
    ok: false,
    erreur: 'Accès non autorisé.'
  };
}

/**
 * POST /api/rapports
 * Créer un rapport journalier
 */
router.post('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const gerantId = req.session.userId;
  const { date_rapport, soldes, gaz, depenses, observation } = req.body;

  if (!date_rapport || !soldes || !gaz) {
    return res.status(400).json({ erreur: 'Données incomplètes.' });
  }

  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const rRes = await client.query(
      `
      INSERT INTO rapports (site_id, gerant_id, date_rapport, observation, last_modified_by)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [siteId, gerantId, date_rapport, observation || null, gerantId]
    );

    const rapportId = rRes.rows[0].id;

    await client.query(
      `
      INSERT INTO rapport_soldes
        (rapport_id, orange_rev, orange_pdv, wave, mtn, moov, moov_p2, tresor, especes, unites)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        rapportId,
        toPositiveInt(soldes.orange_rev),
        toPositiveInt(soldes.orange_pdv),
        toPositiveInt(soldes.wave),
        toPositiveInt(soldes.mtn),
        toPositiveInt(soldes.moov),
        toPositiveInt(soldes.moov_p2),
        toPositiveInt(soldes.tresor),
        toPositiveInt(soldes.especes),
        toPositiveInt(soldes.unites)
      ]
    );

    await client.query(
      `
      INSERT INTO rapport_gaz
        (rapport_id, b12_vendues, b12_rechargees, b12_fuites, b6_vendues, b6_rechargees, b6_fuites)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      `,
      [
        rapportId,
        toPositiveInt(gaz.b12v),
        toPositiveInt(gaz.b12r),
        toPositiveInt(gaz.b12f),
        toPositiveInt(gaz.b6v),
        toPositiveInt(gaz.b6r),
        toPositiveInt(gaz.b6f)
      ]
    );

    if (depenses && depenses.length > 0) {
      for (const dep of depenses) {
        await client.query(
          `
          INSERT INTO rapport_depenses (rapport_id, description, montant)
          VALUES ($1, $2, $3)
          `,
          [
            rapportId,
            dep.description,
            toPositiveInt(dep.montant)
          ]
        );
      }
    }

    // Mise à jour stock gaz
    await client.query(
      `
      UPDATE gaz_config SET
        b12_pleines = b12_pleines + $1::int - $2::int,
        b12_vides   = b12_vides   - $1::int + $2::int,
        b6_pleines  = b6_pleines  + $3::int - $4::int,
        b6_vides    = b6_vides    - $3::int + $4::int,
        b12_stock   = b12_stock   + $1::int - $2::int - $5::int,
        b6_stock    = b6_stock    + $3::int - $4::int - $6::int,
        mis_a_jour  = NOW()
      WHERE site_id = $7
      `,
      [
        toPositiveInt(gaz.b12r),
        toPositiveInt(gaz.b12v),
        toPositiveInt(gaz.b6r),
        toPositiveInt(gaz.b6v),
        toPositiveInt(gaz.b12f),
        toPositiveInt(gaz.b6f),
        siteId
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({ ok: true, rapport_id: rapportId });
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

/**
 * GET /api/rapports
 * Liste des rapports
 */
router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, limit = 31 } = req.query;

  try {
    let query = `
      SELECT
        r.id,
        r.date_rapport,
        r.observation,
        r.statut,
        r.created_at,
        r.updated_at,
        r.gerant_id,
        u.nom AS gerant_nom,
        s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov,
        s.moov_p2, s.tresor, s.especes, s.unites,
        g.b12_vendues, g.b12_rechargees, g.b12_fuites,
        g.b6_vendues,  g.b6_rechargees,  g.b6_fuites
      FROM rapports r
      JOIN utilisateurs u       ON r.gerant_id  = u.id
      LEFT JOIN rapport_soldes s ON s.rapport_id = r.id
      LEFT JOIN rapport_gaz    g ON g.rapport_id = r.id
      WHERE r.site_id = $1
    `;
    const params = [siteId];

    if (mois) {
      params.push(mois);
      query += ` AND to_char(r.date_rapport, 'YYYY-MM') = $${params.length}`;
    }

    query += ` ORDER BY r.date_rapport DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));

    const result = await db.query(query, params);
    const rapports = result.rows;

    for (const r of rapports) {
      const deps = await db.query(
        `SELECT description, montant FROM rapport_depenses WHERE rapport_id = $1`,
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

/**
 * GET /api/rapports/:id
 * Détail d'un rapport
 */
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId = req.session.siteId;

  try {
    const result = await db.query(
      `
      SELECT
        r.*,
        u.nom AS gerant_nom,
        s.orange_rev, s.orange_pdv, s.wave, s.mtn, s.moov,
        s.moov_p2, s.tresor, s.especes, s.unites,
        g.b12_vendues, g.b12_rechargees, g.b12_fuites,
        g.b6_vendues,  g.b6_rechargees,  g.b6_fuites
      FROM rapports r
      JOIN utilisateurs u       ON r.gerant_id  = u.id
      LEFT JOIN rapport_soldes s ON s.rapport_id = r.id
      LEFT JOIN rapport_gaz    g ON g.rapport_id = r.id
      WHERE r.id = $1
        AND r.site_id = $2
      `,
      [id, siteId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ erreur: 'Rapport introuvable.' });
    }

    const rapport = result.rows[0];
    const deps = await db.query(
      `SELECT description, montant FROM rapport_depenses WHERE rapport_id = $1`,
      [id]
    );
    rapport.depenses = deps.rows;

    res.json(rapport);
  } catch (err) {
    console.error('Erreur détail rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * PUT /api/rapports/:id
 * Modifier un rapport
 */
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId = req.session.siteId;
  const userId = req.session.userId;
  const { soldes, gaz, depenses, observation, motif } = req.body;

  const client = await db.pool.connect();

  try {
    const check = await client.query(
      `
      SELECT r.*
      FROM rapports r
      WHERE r.id = $1
        AND r.site_id = $2
      `,
      [id, siteId]
    );

    if (check.rows.length === 0) {
      return res.status(404).json({ erreur: 'Rapport introuvable.' });
    }

    const rapport = check.rows[0];
    const droit = verifierDroitModification(rapport, req.session);

    if (!droit.ok) {
      return res.status(403).json({ erreur: droit.erreur });
    }

    const oldGazRes = await client.query(
      `
      SELECT
        b12_vendues, b12_rechargees, b12_fuites,
        b6_vendues,  b6_rechargees,  b6_fuites
      FROM rapport_gaz
      WHERE rapport_id = $1
      `,
      [id]
    );

    const oldGaz = oldGazRes.rows[0] || {
      b12_vendues: 0,
      b12_rechargees: 0,
      b12_fuites: 0,
      b6_vendues: 0,
      b6_rechargees: 0,
      b6_fuites: 0
    };

    const newB12v = toPositiveInt(gaz?.b12v);
    const newB12r = toPositiveInt(gaz?.b12r);
    const newB12f = toPositiveInt(gaz?.b12f);
    const newB6v = toPositiveInt(gaz?.b6v);
    const newB6r = toPositiveInt(gaz?.b6r);
    const newB6f = toPositiveInt(gaz?.b6f);

    const deltaB12r = newB12r - Number(oldGaz.b12_rechargees || 0);
    const deltaB12v = newB12v - Number(oldGaz.b12_vendues || 0);
    const deltaB12f = newB12f - Number(oldGaz.b12_fuites || 0);
    const deltaB6r = newB6r - Number(oldGaz.b6_rechargees || 0);
    const deltaB6v = newB6v - Number(oldGaz.b6_vendues || 0);
    const deltaB6f = newB6f - Number(oldGaz.b6_fuites || 0);

    await client.query('BEGIN');

    await client.query(
      `
      UPDATE rapports
      SET observation = $1,
          updated_at = NOW(),
          last_modified_by = $2
      WHERE id = $3
      `,
      [observation || null, userId, id]
    );

    await client.query(
      `
      UPDATE rapport_soldes
      SET orange_rev = $1,
          orange_pdv = $2,
          wave = $3,
          mtn = $4,
          moov = $5,
          moov_p2 = $6,
          tresor = $7,
          especes = $8,
          unites = $9
      WHERE rapport_id = $10
      `,
      [
        toPositiveInt(soldes?.orange_rev),
        toPositiveInt(soldes?.orange_pdv),
        toPositiveInt(soldes?.wave),
        toPositiveInt(soldes?.mtn),
        toPositiveInt(soldes?.moov),
        toPositiveInt(soldes?.moov_p2),
        toPositiveInt(soldes?.tresor),
        toPositiveInt(soldes?.especes),
        toPositiveInt(soldes?.unites),
        id
      ]
    );

    await client.query(
      `
      UPDATE rapport_gaz
      SET b12_vendues = $1,
          b12_rechargees = $2,
          b12_fuites = $3,
          b6_vendues = $4,
          b6_rechargees = $5,
          b6_fuites = $6
      WHERE rapport_id = $7
      `,
      [newB12v, newB12r, newB12f, newB6v, newB6r, newB6f, id]
    );

    await client.query(
      `
      DELETE FROM rapport_depenses
      WHERE rapport_id = $1
      `,
      [id]
    );

    if (depenses && depenses.length > 0) {
      for (const dep of depenses) {
        await client.query(
          `
          INSERT INTO rapport_depenses (rapport_id, description, montant)
          VALUES ($1, $2, $3)
          `,
          [id, dep.description, toPositiveInt(dep.montant)]
        );
      }
    }

    // Réajustement du stock gaz par différence ancien -> nouveau
    await client.query(
      `
      UPDATE gaz_config SET
        b12_pleines = b12_pleines + $1::int - $2::int,
        b12_vides   = b12_vides   - $1::int + $2::int,
        b6_pleines  = b6_pleines  + $3::int - $4::int,
        b6_vides    = b6_vides    - $3::int + $4::int,
        b12_stock   = b12_stock   + $1::int - $2::int - $5::int,
        b6_stock    = b6_stock    + $3::int - $4::int - $6::int,
        mis_a_jour  = NOW()
      WHERE site_id = $7
      `,
      [
        deltaB12r,
        deltaB12v,
        deltaB6r,
        deltaB6v,
        deltaB12f,
        deltaB6f,
        siteId
      ]
    );

    await client.query(
      `
      INSERT INTO rapport_modifications (rapport_id, modifie_par, motif)
      VALUES ($1, $2, $3)
      `,
      [id, userId, motif || 'Modification rapport']
    );

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