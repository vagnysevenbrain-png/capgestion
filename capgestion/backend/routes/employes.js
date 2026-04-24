const express = require('express');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return defaultValue;
    return Math.round(n);
}

/**
 * GET /api/employes
 * Liste des employés du site
 * Réservé au propriétaire
 */
router.get('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { actif } = req.query;

    try {
        let query = `
      SELECT
        id,
        site_id,
        nom,
        poste,
        salaire_base,
        actif,
        deleted_at,
        created_at,
        updated_at
      FROM employes
      WHERE site_id = $1
        AND deleted_at IS NULL
    `;
        const params = [siteId];

        if (actif === 'true') {
            params.push(true);
            query += ` AND actif = $${params.length}`;
        } else if (actif === 'false') {
            params.push(false);
            query += ` AND actif = $${params.length}`;
        }

        query += ` ORDER BY nom ASC`;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erreur liste employés:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/employes
 * Créer un employé
 * Réservé au propriétaire
 */
router.post('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { nom, poste, salaire_base } = req.body;

    if (!nom || !nom.trim()) {
        return res.status(400).json({ erreur: 'Nom requis.' });
    }

    try {
        const result = await db.query(
            `
      INSERT INTO employes (
        site_id,
        nom,
        poste,
        salaire_base
      )
      VALUES ($1, $2, $3, $4)
      RETURNING id, nom, poste, salaire_base, actif, created_at
      `,
            [
                siteId,
                nom.trim(),
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
 * PATCH /api/employes/:id
 * Modifier les infos d'un employé
 * Réservé au propriétaire
 */
router.patch('/:id', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;
    const { nom, poste, salaire_base } = req.body;

    if (!nom || !nom.trim()) {
        return res.status(400).json({ erreur: 'Nom requis.' });
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
        AND deleted_at IS NULL
      RETURNING id, nom, poste, salaire_base, actif, updated_at
      `,
            [
                nom.trim(),
                poste?.trim() || null,
                toPositiveInt(salaire_base),
                id,
                siteId
            ]
        );

        if (result.rows.length === 0) {
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
 * PATCH /api/employes/:id/statut
 * Activer / désactiver un employé
 * Réservé au propriétaire
 */
router.patch('/:id/statut', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;
    const { actif } = req.body;

    if (typeof actif !== 'boolean') {
        return res.status(400).json({ erreur: 'Le champ actif doit être true ou false.' });
    }

    try {
        const result = await db.query(
            `
      UPDATE employes
      SET actif = $1,
          updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
        AND deleted_at IS NULL
      RETURNING id, nom, actif
      `,
            [actif, id, siteId]
        );

        if (result.rows.length === 0) {
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
 * DELETE /api/employes/:id
 * Suppression logique
 * Réservé au propriétaire
 */
router.delete('/:id', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;

    try {
        const result = await db.query(
            `
      UPDATE employes
      SET deleted_at = NOW(),
          actif = FALSE,
          updated_at = NOW()
      WHERE id = $1
        AND site_id = $2
        AND deleted_at IS NULL
      RETURNING id, nom
      `,
            [id, siteId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erreur: 'Employé introuvable.' });
        }

        res.json({
            ok: true,
            message: 'Employé supprimé.',
            employe: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur suppression employé:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * GET /api/employes/salaires/:mois
 * Liste des salaires d'un mois (YYYY-MM)
 * Réservé au propriétaire
 */
router.get('/salaires/:mois', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const mois = `${req.params.mois}-01`;

    try {
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
            [siteId, mois]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Erreur lecture salaires du mois:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/employes/:id/salaires
 * Créer ou mettre à jour le salaire mensuel d'un employé
 * Réservé au propriétaire
 */
router.post('/:id/salaires', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const userId = req.session.userId;
    const { id } = req.params;
    const { mois, bonus, retenues, statut, observation } = req.body;

    if (!mois || !/^\d{4}-\d{2}$/.test(mois)) {
        return res.status(400).json({ erreur: 'Le mois doit être au format YYYY-MM.' });
    }

    const bonusNum = toPositiveInt(bonus);
    const retenuesNum = toPositiveInt(retenues);
    const statutFinal = statut || 'en_attente';

    if (!['en_attente', 'valide', 'paye'].includes(statutFinal)) {
        return res.status(400).json({ erreur: 'Statut invalide.' });
    }

    try {
        const empRes = await db.query(
            `
      SELECT id, nom, salaire_base
      FROM employes
      WHERE id = $1
        AND site_id = $2
        AND deleted_at IS NULL
      `,
            [id, siteId]
        );

        if (empRes.rows.length === 0) {
            return res.status(404).json({ erreur: 'Employé introuvable.' });
        }

        const employe = empRes.rows[0];
        const salaireBase = Number(employe.salaire_base) || 0;
        const salaireNet = Math.max(0, salaireBase + bonusNum - retenuesNum);

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
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (employe_id, mois)
      DO UPDATE SET
        salaire_base_snapshot = EXCLUDED.salaire_base_snapshot,
        bonus = EXCLUDED.bonus,
        retenues = EXCLUDED.retenues,
        salaire_net = EXCLUDED.salaire_net,
        statut = EXCLUDED.statut,
        observation = EXCLUDED.observation,
        updated_at = NOW()
      RETURNING
        id,
        employe_id,
        mois,
        salaire_base_snapshot,
        bonus,
        retenues,
        salaire_net,
        statut,
        observation
      `,
            [
                id,
                `${mois}-01`,
                salaireBase,
                bonusNum,
                retenuesNum,
                salaireNet,
                statutFinal,
                observation?.trim() || null,
                userId
            ]
        );

        res.json({
            ok: true,
            salaire: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur création/mise à jour salaire mensuel:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * GET /api/employes/salaires/:mois/total
 * Total des salaires nets du mois pour le site
 * Réservé au propriétaire
 */
router.get('/salaires/:mois/total', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const mois = `${req.params.mois}-01`;

    try {
        const result = await db.query(
            `
      SELECT COALESCE(SUM(sm.salaire_net), 0) AS total_salaires
      FROM salaires_mois sm
      JOIN employes e ON e.id = sm.employe_id
      WHERE e.site_id = $1
        AND sm.mois = $2
      `,
            [siteId, mois]
        );

        res.json({
            mois: req.params.mois,
            total_salaires: Number(result.rows[0].total_salaires || 0)
        });
    } catch (err) {
        console.error('Erreur total salaires du mois:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

module.exports = router;