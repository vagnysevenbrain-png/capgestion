const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return defaultValue;
  return Math.round(n);
}

function toIsoDate(value) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
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

function isTodayString(dateValue) {
  const today = new Date().toISOString().slice(0, 10);
  const d = new Date(dateValue).toISOString().slice(0, 10);
  return d === today;
}

async function syncFondMmFromSoldes(client, siteId, soldes) {
  const orange_rev = toPositiveInt(soldes?.orange_rev);
  const orange_pdv = toPositiveInt(soldes?.orange_pdv);
  const wave = toPositiveInt(soldes?.wave);
  const mtn = toPositiveInt(soldes?.mtn);
  const moov = toPositiveInt(soldes?.moov);
  const moov_p2 = toPositiveInt(soldes?.moov_p2);
  const tresor = toPositiveInt(soldes?.tresor);
  const especes = toPositiveInt(soldes?.especes);
  const unites = toPositiveInt(soldes?.unites);
  const orange_total = orange_rev + orange_pdv;

  await client.query(
    `
    UPDATE fond_mm
    SET
      orange_rev = $1,
      orange_pdv = $2,
      orange_total = $3,
      wave = $4,
      mtn = $5,
      moov = $6,
      moov_p2 = $7,
      tresor = $8,
      especes = $9,
      unites = $10,
      mis_a_jour = NOW()
    WHERE site_id = $11
    `,
    [
      orange_rev,
      orange_pdv,
      orange_total,
      wave,
      mtn,
      moov,
      moov_p2,
      tresor,
      especes,
      unites,
      siteId
    ]
  );
}

async function getRapportBaseById(clientOrDb, id, siteId) {
  const result = await clientOrDb.query(
    `
    SELECT
      r.id,
      r.site_id,
      r.gerant_id,
      r.date_rapport,
      r.observation,
      r.statut,
      r.created_at,
      r.updated_at,
      r.last_modified_by,

      gu.nom AS gerant_nom,
      mu.nom AS last_modified_by_nom,

      s.orange_rev,
      s.orange_pdv,
      s.wave,
      s.mtn,
      s.moov,
      s.moov_p2,
      s.tresor,
      s.especes,
      s.unites,

      g.b12_vendues,
      g.b12_rechargees,
      g.b12_fuites,
      g.b6_vendues,
      g.b6_rechargees,
      g.b6_fuites,
      g.caisse_gaz_disponible
    FROM rapports r
    JOIN utilisateurs gu
      ON r.gerant_id = gu.id
    LEFT JOIN utilisateurs mu
      ON r.last_modified_by = mu.id
    LEFT JOIN rapport_soldes s
      ON s.rapport_id = r.id
    LEFT JOIN rapport_gaz g
      ON g.rapport_id = r.id
    WHERE r.id = $1
      AND r.site_id = $2
    LIMIT 1
    `,
    [id, siteId]
  );

  return result.rows[0] || null;
}

async function getRapportBaseByDate(clientOrDb, dateRapport, siteId) {
  const result = await clientOrDb.query(
    `
    SELECT
      r.id,
      r.site_id,
      r.gerant_id,
      r.date_rapport,
      r.observation,
      r.statut,
      r.created_at,
      r.updated_at,
      r.last_modified_by,

      gu.nom AS gerant_nom,
      mu.nom AS last_modified_by_nom,

      s.orange_rev,
      s.orange_pdv,
      s.wave,
      s.mtn,
      s.moov,
      s.moov_p2,
      s.tresor,
      s.especes,
      s.unites,

      g.b12_vendues,
      g.b12_rechargees,
      g.b12_fuites,
      g.b6_vendues,
      g.b6_rechargees,
      g.b6_fuites,
      g.caisse_gaz_disponible
    FROM rapports r
    JOIN utilisateurs gu
      ON r.gerant_id = gu.id
    LEFT JOIN utilisateurs mu
      ON r.last_modified_by = mu.id
    LEFT JOIN rapport_soldes s
      ON s.rapport_id = r.id
    LEFT JOIN rapport_gaz g
      ON g.rapport_id = r.id
    WHERE r.site_id = $1
      AND r.date_rapport = $2::date
    LIMIT 1
    `,
    [siteId, dateRapport]
  );

  return result.rows[0] || null;
}

async function getDepensesByRapportId(clientOrDb, rapportId) {
  const deps = await clientOrDb.query(
    `
    SELECT description, montant
    FROM rapport_depenses
    WHERE rapport_id = $1
    ORDER BY id ASC
    `,
    [rapportId]
  );

  return deps.rows;
}

async function enrichRapport(clientOrDb, rapport, session) {
  if (!rapport) return null;

  const depenses = await getDepensesByRapportId(clientOrDb, rapport.id);
  const droit = verifierDroitModification(rapport, session);

  return {
    ...rapport,
    date_rapport: toIsoDate(rapport.date_rapport),
    modifiable: droit.ok,
    raison_non_modifiable: droit.ok ? null : droit.erreur,
    depenses
  };
}

/**
 * POST /api/rapports
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
    const existing = await getRapportBaseByDate(client, date_rapport, siteId);

    if (existing) {
      const droit = verifierDroitModification(existing, req.session);
      return res.status(409).json({
        erreur: 'Un rapport existe déjà pour cette date.',
        rapport_id: existing.id,
        modifiable: droit.ok,
        raison_non_modifiable: droit.ok ? null : droit.erreur
      });
    }

    await client.query('BEGIN');

    const rRes = await client.query(
      `
      INSERT INTO rapports (
        site_id,
        gerant_id,
        date_rapport,
        observation,
        last_modified_by
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id
      `,
      [siteId, gerantId, date_rapport, observation || null, gerantId]
    );

    const rapportId = rRes.rows[0].id;

    const soldesPayload = {
      orange_rev: toPositiveInt(soldes.orange_rev),
      orange_pdv: toPositiveInt(soldes.orange_pdv),
      wave: toPositiveInt(soldes.wave),
      mtn: toPositiveInt(soldes.mtn),
      moov: toPositiveInt(soldes.moov),
      moov_p2: toPositiveInt(soldes.moov_p2),
      tresor: toPositiveInt(soldes.tresor),
      especes: toPositiveInt(soldes.especes),
      unites: toPositiveInt(soldes.unites)
    };

    await client.query(
      `
      INSERT INTO rapport_soldes
        (rapport_id, orange_rev, orange_pdv, wave, mtn, moov, moov_p2, tresor, especes, unites)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      `,
      [
        rapportId,
        soldesPayload.orange_rev,
        soldesPayload.orange_pdv,
        soldesPayload.wave,
        soldesPayload.mtn,
        soldesPayload.moov,
        soldesPayload.moov_p2,
        soldesPayload.tresor,
        soldesPayload.especes,
        soldesPayload.unites
      ]
    );

    await client.query(
      `
      INSERT INTO rapport_gaz
        (
          rapport_id,
          b12_vendues,
          b12_rechargees,
          b12_fuites,
          b6_vendues,
          b6_rechargees,
          b6_fuites,
          caisse_gaz_disponible
        )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      `,
      [
        rapportId,
        toPositiveInt(gaz.b12v),
        toPositiveInt(gaz.b12r),
        toPositiveInt(gaz.b12f),
        toPositiveInt(gaz.b6v),
        toPositiveInt(gaz.b6r),
        toPositiveInt(gaz.b6f),
        toPositiveInt(gaz.caisse_gaz_disponible ?? gaz.caisse_disponible)
      ]
    );

    if (depenses && depenses.length > 0) {
      for (const dep of depenses) {
        await client.query(
          `
          INSERT INTO rapport_depenses (rapport_id, description, montant)
          VALUES ($1, $2, $3)
          `,
          [rapportId, dep.description, toPositiveInt(dep.montant)]
        );
      }
    }

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

    if (isTodayString(date_rapport)) {
      await syncFondMmFromSoldes(client, siteId, soldesPayload);
    }

    await client.query(
      `
      INSERT INTO rapport_modifications (rapport_id, modifie_par, motif)
      VALUES ($1, $2, $3)
      `,
      [rapportId, gerantId, 'Création rapport']
    );

    await client.query('COMMIT');

    const saved = await getRapportBaseById(db, rapportId, siteId);
    const enriched = await enrichRapport(db, saved, req.session);

    res.status(201).json({ ok: true, rapport: enriched });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur création rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

/**
 * GET /api/rapports
 * ?mois=YYYY-MM
 * ?date=YYYY-MM-DD
 */
router.get('/', requireAuth, async (req, res) => {
  const siteId = req.session.siteId;
  const { mois, date, limit = 31 } = req.query;

  try {
    let query = `
      SELECT
        r.id,
        r.site_id,
        r.date_rapport,
        r.observation,
        r.statut,
        r.created_at,
        r.updated_at,
        r.gerant_id,
        r.last_modified_by,

        gu.nom AS gerant_nom,
        mu.nom AS last_modified_by_nom,

        s.orange_rev,
        s.orange_pdv,
        s.wave,
        s.mtn,
        s.moov,
        s.moov_p2,
        s.tresor,
        s.especes,
        s.unites,

        g.b12_vendues,
        g.b12_rechargees,
        g.b12_fuites,
        g.b6_vendues,
        g.b6_rechargees,
        g.b6_fuites,
        g.caisse_gaz_disponible,

        COALESCE(g.b12_vendues, 0) * COALESCE(gc.b12_commission, 0)
        + COALESCE(g.b6_vendues, 0) * COALESCE(gc.b6_commission, 0)
        AS commission_gaz_jour,

        rm_last.motif AS motif_derniere_modification,
        rm_last.modification_par_nom
      FROM rapports r
      JOIN utilisateurs gu
        ON r.gerant_id = gu.id
      LEFT JOIN utilisateurs mu
        ON r.last_modified_by = mu.id
      LEFT JOIN rapport_soldes s
        ON s.rapport_id = r.id
      LEFT JOIN rapport_gaz g
        ON g.rapport_id = r.id
      LEFT JOIN gaz_config gc
        ON gc.site_id = r.site_id
      LEFT JOIN LATERAL (
        SELECT
          rm.motif,
          u2.nom AS modification_par_nom
        FROM rapport_modifications rm
        LEFT JOIN utilisateurs u2
          ON u2.id = rm.modifie_par
        WHERE rm.rapport_id = r.id
        ORDER BY rm.id DESC
        LIMIT 1
      ) rm_last ON TRUE
      WHERE r.site_id = $1
    `;
    const params = [siteId];

    if (date) {
      params.push(date);
      query += ` AND r.date_rapport = $${params.length}::date`;
    } else if (mois) {
      params.push(mois);
      query += ` AND to_char(r.date_rapport, 'YYYY-MM') = $${params.length}`;
    }

    query += ` ORDER BY r.date_rapport DESC, r.id DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit, 10));

    const result = await db.query(query, params);
    const rapports = result.rows;

    for (const r of rapports) {
      const deps = await db.query(
        `SELECT description, montant FROM rapport_depenses WHERE rapport_id = $1 ORDER BY id ASC`,
        [r.id]
      );
      r.depenses = deps.rows;

      const droit = verifierDroitModification(r, req.session);
      r.modifiable = droit.ok;
      r.raison_non_modifiable = droit.ok ? null : droit.erreur;
      r.date_rapport = toIsoDate(r.date_rapport);
    }

    res.json(rapports);
  } catch (err) {
    console.error('Erreur liste rapports:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});;

/**
 * GET /api/rapports/:id
 */
router.get('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId = req.session.siteId;

  try {
    const rapport = await getRapportBaseById(db, id, siteId);

    if (!rapport) {
      return res.status(404).json({ erreur: 'Rapport introuvable.' });
    }

    const enriched = await enrichRapport(db, rapport, req.session);
    res.json(enriched);
  } catch (err) {
    console.error('Erreur détail rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

/**
 * PUT /api/rapports/:id
 */
router.put('/:id', requireAuth, async (req, res) => {
  const { id } = req.params;
  const siteId = req.session.siteId;
  const userId = req.session.userId;
  const { soldes, gaz, depenses, observation, motif } = req.body;

  const client = await db.pool.connect();

  try {
    const rapport = await getRapportBaseById(client, id, siteId);

    if (!rapport) {
      return res.status(404).json({ erreur: 'Rapport introuvable.' });
    }

    const droit = verifierDroitModification(rapport, req.session);

    if (!droit.ok) {
      return res.status(403).json({ erreur: droit.erreur });
    }

    const oldGaz = {
      b12_vendues: toPositiveInt(rapport.b12_vendues),
      b12_rechargees: toPositiveInt(rapport.b12_rechargees),
      b12_fuites: toPositiveInt(rapport.b12_fuites),
      b6_vendues: toPositiveInt(rapport.b6_vendues),
      b6_rechargees: toPositiveInt(rapport.b6_rechargees),
      b6_fuites: toPositiveInt(rapport.b6_fuites),
      caisse_gaz_disponible: toPositiveInt(rapport.caisse_gaz_disponible)
    };

    const newB12v = toPositiveInt(gaz?.b12v);
    const newB12r = toPositiveInt(gaz?.b12r);
    const newB12f = toPositiveInt(gaz?.b12f);
    const newB6v = toPositiveInt(gaz?.b6v);
    const newB6r = toPositiveInt(gaz?.b6r);
    const newB6f = toPositiveInt(gaz?.b6f);
    const newCaisseGazDisponible = toPositiveInt(
      gaz?.caisse_gaz_disponible ?? gaz?.caisse_disponible
    );

    const deltaB12r = newB12r - oldGaz.b12_rechargees;
    const deltaB12v = newB12v - oldGaz.b12_vendues;
    const deltaB12f = newB12f - oldGaz.b12_fuites;
    const deltaB6r = newB6r - oldGaz.b6_rechargees;
    const deltaB6v = newB6v - oldGaz.b6_vendues;
    const deltaB6f = newB6f - oldGaz.b6_fuites;

    const soldesPayload = {
      orange_rev: toPositiveInt(soldes?.orange_rev),
      orange_pdv: toPositiveInt(soldes?.orange_pdv),
      wave: toPositiveInt(soldes?.wave),
      mtn: toPositiveInt(soldes?.mtn),
      moov: toPositiveInt(soldes?.moov),
      moov_p2: toPositiveInt(soldes?.moov_p2),
      tresor: toPositiveInt(soldes?.tresor),
      especes: toPositiveInt(soldes?.especes),
      unites: toPositiveInt(soldes?.unites)
    };

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
        soldesPayload.orange_rev,
        soldesPayload.orange_pdv,
        soldesPayload.wave,
        soldesPayload.mtn,
        soldesPayload.moov,
        soldesPayload.moov_p2,
        soldesPayload.tresor,
        soldesPayload.especes,
        soldesPayload.unites,
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
          b6_fuites = $6,
          caisse_gaz_disponible = $7
      WHERE rapport_id = $8
      `,
      [newB12v, newB12r, newB12f, newB6v, newB6r, newB6f, newCaisseGazDisponible, id]
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

    if (isTodayString(rapport.date_rapport)) {
      await syncFondMmFromSoldes(client, siteId, soldesPayload);
    }

    await client.query(
      `
      INSERT INTO rapport_modifications (rapport_id, modifie_par, motif)
      VALUES ($1, $2, $3)
      `,
      [id, userId, motif || 'Modification rapport']
    );

    await client.query('COMMIT');

    const saved = await getRapportBaseById(db, id, siteId);
    const enriched = await enrichRapport(db, saved, req.session);

    res.json({ ok: true, rapport: enriched });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur modification rapport:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  } finally {
    client.release();
  }
});

module.exports = router;