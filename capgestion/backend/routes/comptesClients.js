const express = require('express');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function toPositiveInt(value, defaultValue = 0) {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return defaultValue;
    return Math.round(n);
}

/**
 * GET /api/comptes-clients/test-auth
 * Vérification simple de la session sur ce module
 */
router.get('/test-auth', requireAuth, async (req, res) => {
    res.json({
        ok: true,
        userId: req.session.userId,
        siteId: req.session.siteId,
        role: req.session.role
    });
});

/**
 * GET /api/comptes-clients
 * Liste des comptes clients
 * Query params:
 * - actif=true|false
 * - q=texte de recherche
 */
router.get('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const { actif, q } = req.query;

    try {
        let query = `
      SELECT
        cc.id,
        cc.site_id,
        cc.nom,
        cc.telephone,
        cc.observation,
        cc.actif,
        cc.deleted_at,
        cc.created_at,
        cc.updated_at,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN m.type_mvt IN ('credit', 'ajustement_plus') THEN m.montant
              WHEN m.type_mvt IN ('remboursement', 'avance', 'ajustement_moins') THEN -m.montant
              ELSE 0
            END
          )
          FROM compte_client_mouvements m
          WHERE m.compte_client_id = cc.id
        ), 0) AS solde_compte
      FROM comptes_clients cc
      WHERE cc.site_id = $1
        AND cc.deleted_at IS NULL
    `;
        const params = [siteId];

        if (actif === 'true') {
            params.push(true);
            query += ` AND cc.actif = $${params.length}`;
        } else if (actif === 'false') {
            params.push(false);
            query += ` AND cc.actif = $${params.length}`;
        }

        if (q && q.trim()) {
            params.push(`%${q.trim().toLowerCase()}%`);
            query += ` AND LOWER(cc.nom) LIKE $${params.length}`;
        }

        query += ` ORDER BY cc.nom ASC`;

        const result = await db.query(query, params);
        res.json(result.rows);
    } catch (err) {
        console.error('Erreur liste comptes clients:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * GET /api/comptes-clients/:id
 * Détail d'un compte + mouvements
 */
router.get('/:id', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;

    try {
        const compteRes = await db.query(
            `
      SELECT
        cc.id,
        cc.site_id,
        cc.nom,
        cc.telephone,
        cc.observation,
        cc.actif,
        cc.deleted_at,
        cc.created_at,
        cc.updated_at,
        COALESCE((
          SELECT SUM(
            CASE
              WHEN m.type_mvt IN ('credit', 'ajustement_plus') THEN m.montant
              WHEN m.type_mvt IN ('remboursement', 'avance', 'ajustement_moins') THEN -m.montant
              ELSE 0
            END
          )
          FROM compte_client_mouvements m
          WHERE m.compte_client_id = cc.id
        ), 0) AS solde_compte
      FROM comptes_clients cc
      WHERE cc.id = $1
        AND cc.site_id = $2
        AND cc.deleted_at IS NULL
      `,
            [id, siteId]
        );

        if (compteRes.rows.length === 0) {
            return res.status(404).json({ erreur: 'Compte client introuvable.' });
        }

        const mouvementsRes = await db.query(
            `
      SELECT
        id,
        compte_client_id,
        date_mouvement,
        type_mvt,
        montant,
        mode_paiement,
        note,
        cree_par,
        created_at
      FROM compte_client_mouvements
      WHERE compte_client_id = $1
      ORDER BY date_mouvement DESC, id DESC
      `,
            [id]
        );

        res.json({
            compte: compteRes.rows[0],
            mouvements: mouvementsRes.rows
        });
    } catch (err) {
        console.error('Erreur détail compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/comptes-clients
 * Créer un compte client
 */
router.post('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const userId = req.session.userId;
    const { nom, telephone, observation } = req.body;

    if (!nom || !nom.trim()) {
        return res.status(400).json({ erreur: 'Nom requis.' });
    }

    try {
        const result = await db.query(
            `
      INSERT INTO comptes_clients (
        site_id,
        nom,
        telephone,
        observation,
        created_by
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING
        id,
        site_id,
        nom,
        telephone,
        observation,
        actif,
        created_at,
        updated_at
      `,
            [
                siteId,
                nom.trim(),
                telephone?.trim() || null,
                observation?.trim() || null,
                userId
            ]
        );

        res.status(201).json({
            ok: true,
            compte: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur création compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/comptes-clients/:id/mouvements
 * Ajouter un mouvement sur un compte client
 */
router.post('/:id/mouvements', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const userId = req.session.userId;
    const { id } = req.params;
    const { type_mvt, montant, mode_paiement, note, date_mouvement } = req.body;

    const typesAutorises = [
        'credit',
        'remboursement',
        'avance',
        'ajustement_plus',
        'ajustement_moins'
    ];

    if (!typesAutorises.includes(type_mvt)) {
        return res.status(400).json({ erreur: 'Type de mouvement invalide.' });
    }

    const montantNum = toPositiveInt(montant, 0);
    if (montantNum <= 0) {
        return res.status(400).json({ erreur: 'Montant invalide.' });
    }

    try {
        const compteRes = await db.query(
            `
      SELECT id, actif, deleted_at
      FROM comptes_clients
      WHERE id = $1
        AND site_id = $2
      `,
            [id, siteId]
        );

        if (compteRes.rows.length === 0) {
            return res.status(404).json({ erreur: 'Compte client introuvable.' });
        }

        const compte = compteRes.rows[0];

        if (compte.deleted_at) {
            return res.status(400).json({ erreur: 'Compte supprimé.' });
        }

        if (!compte.actif) {
            return res.status(400).json({ erreur: 'Compte inactif.' });
        }

        const result = await db.query(
            `
      INSERT INTO compte_client_mouvements (
        compte_client_id,
        date_mouvement,
        type_mvt,
        montant,
        mode_paiement,
        note,
        cree_par
      )
      VALUES ($1, COALESCE($2, NOW()), $3, $4, $5, $6, $7)
      RETURNING
        id,
        compte_client_id,
        date_mouvement,
        type_mvt,
        montant,
        mode_paiement,
        note,
        cree_par,
        created_at
      `,
            [
                id,
                date_mouvement || null,
                type_mvt,
                montantNum,
                mode_paiement?.trim() || null,
                note?.trim() || null,
                userId
            ]
        );

        res.status(201).json({
            ok: true,
            mouvement: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur ajout mouvement compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PATCH /api/comptes-clients/:id/statut
 * Activer / désactiver un compte client
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
      UPDATE comptes_clients
      SET actif = $1,
          updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
        AND deleted_at IS NULL
      RETURNING id, nom, actif, updated_at
      `,
            [actif, id, siteId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erreur: 'Compte client introuvable.' });
        }

        res.json({
            ok: true,
            compte: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur changement statut compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * DELETE /api/comptes-clients/:id
 * Suppression logique
 * Réservé au propriétaire
 */
router.delete('/:id', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;

    try {
        const result = await db.query(
            `
      UPDATE comptes_clients
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
            return res.status(404).json({ erreur: 'Compte client introuvable.' });
        }

        res.json({
            ok: true,
            message: 'Compte client supprimé.',
            compte: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur suppression compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

module.exports = router;