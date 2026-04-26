const express = require('express');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return defaultValue;
    return Math.round(n);
}

function parseActif(value) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return null;
}

function monthToDate(mois) {
    return `${mois}-01`;
}

/**
 * GET /api/employes
 */
router.get('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const actifFilter = parseActif(req.query.actif);

    try {
        const params = [siteId];
        let where = `site_id = $1 AND deleted_at IS NULL`;

        if (actifFilter !== null) {
            params.push(actifFilter);
            where += ` AND actif = $${params.length}`;
        }

        const result = await db.query(
            `
      SELECT *
      FROM employes
      WHERE ${where}
      ORDER BY nom ASC
      `,
            params
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Erreur liste employés:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/employes
 */
router.post('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { nom, poste, salaire_base } = req.body;

    if (!nom || !String(nom).trim()) {
        return res.status(400).json({ erreur: 'Le nom de l’employé est obligatoire.' });
    }

    try {
        const result = await db.query(
            `
      INSERT INTO employes (
        site_id,
        nom,
        poste,
        salaire_base,
        actif
      )
      VALUES ($1, $2, $3, $4, true)
      RETURNING *
      `,
            [
                siteId,
                String(nom).trim(),
                poste?.trim() || null,
                toPositiveInt(salaire_base)
            ]
        );

        res.status(201).json({
            ok: true,
            employe: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur création employé:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PUT /api/employes/:id
 */
router.put('/:id', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const id = Number(req.params.id);
    const { nom, poste, salaire_base } = req.body;

    if (!id) {
        return res.status(400).json({ erreur: 'ID employé invalide.' });
    }

    if (!nom || !String(nom).trim()) {
        return res.status(400).json({ erreur: 'Le nom de l’employé est obligatoire.' });
    }

    try {
        const result = await db.query(
            `
      UPDATE employes
      SET nom = $1,
          poste = $2,
          salaire_base = $3,
          updated_at = NOW()
      WHERE id = $4
        AND site_id = $5
      RETURNING *
      `,
            [
                String(nom).trim(),
                poste?.trim() || null,
                toPositiveInt(salaire_base),
                id,
                siteId
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({ erreur: 'Employé introuvable.' });
        }

        res.json({
            ok: true,
            employe: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur modification employé:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PUT /api/employes/:id/statut
 */
router.put('/:id/statut', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const id = Number(req.params.id);
    const actif = parseActif(req.body.actif);

    if (!id) {
        return res.status(400).json({ erreur: 'ID employé invalide.' });
    }

    if (actif === null) {
        return res.status(400).json({ erreur: 'Valeur actif invalide.' });
    }

    try {
        const result = await db.query(
            `
      UPDATE employes
      SET actif = $1,
          deleted_at = CASE WHEN $1 = false THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
      RETURNING *
      `,
            [actif, id, siteId]
        );

        if (!result.rows.length) {
            return res.status(404).json({ erreur: 'Employé introuvable.' });
        }

        res.json({
            ok: true,
            employe: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur changement statut employé:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/employes/:id/salaires
 */
router.post('/:id/salaires', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const creePar = req.session.userId || null;
    const employeId = Number(req.params.id);
    const { mois, bonus, retenues, statut, observation } = req.body;

    if (!employeId) {
        return res.status(400).json({ erreur: 'ID employé invalide.' });
    }

    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
        return res.status(400).json({ erreur: 'Le mois doit être au format YYYY-MM.' });
    }

    try {
        const employeRes = await db.query(
            `
      SELECT *
      FROM employes
      WHERE id = $1
        AND site_id = $2
      `,
            [employeId, siteId]
        );

        if (!employeRes.rows.length) {
            return res.status(404).json({ erreur: 'Employé introuvable.' });
        }

        const employe = employeRes.rows[0];
        const base = Number(employe.salaire_base || 0);
        const bonusInt = toPositiveInt(bonus);
        const retenuesInt = toPositiveInt(retenues);
        const net = Math.max(0, base + bonusInt - retenuesInt);
        const moisDate = monthToDate(mois);

        const result = await db.query(
            `
      INSERT INTO salaires_mois (
        employe_id,
        mois,
        salaire_base_snapshot,
        bonus,
        retenues,
        salaire_net,
        statut,
        observation,
        cree_par
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (employe_id, mois)
      DO UPDATE SET
        salaire_base_snapshot = EXCLUDED.salaire_base_snapshot,
        bonus = EXCLUDED.bonus,
        retenues = EXCLUDED.retenues,
        salaire_net = EXCLUDED.salaire_net,
        statut = EXCLUDED.statut,
        observation = EXCLUDED.observation,
        cree_par = EXCLUDED.cree_par
      RETURNING *
      `,
            [
                employeId,
                moisDate,
                base,
                bonusInt,
                retenuesInt,
                net,
                statut || 'valide',
                observation?.trim() || null,
                creePar
            ]
        );

        res.json({
            ok: true,
            salaire: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur enregistrement salaire mois:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

module.exports = router;