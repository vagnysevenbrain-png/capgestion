const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

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

async function getCompteAvecSolde(siteId, compteClientId) {
    const result = await db.query(
        `
    SELECT
      cc.*,
      COALESCE(SUM(
        CASE
          WHEN m.type_mvt IN ('credit', 'avance', 'ajustement_plus') THEN m.montant
          WHEN m.type_mvt IN ('remboursement', 'ajustement_moins') THEN -m.montant
          ELSE 0
        END
      ), 0) AS solde_courant
    FROM comptes_clients cc
    LEFT JOIN compte_client_mouvements m
      ON m.compte_client_id = cc.id
    WHERE cc.id = $1
      AND cc.site_id = $2
    GROUP BY
      cc.id, cc.site_id, cc.nom, cc.telephone, cc.observation,
      cc.actif, cc.deleted_at, cc.created_by, cc.created_at, cc.updated_at
    `,
        [compteClientId, siteId]
    );

    return result.rows[0] || null;
}

/**
 * GET /api/comptes-clients
 * Par défaut: retourne actifs + inactifs
 * ?actif=true ou ?actif=false pour filtrer
 */
router.get('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const actifFilter = parseActif(req.query.actif);

    try {
        const params = [siteId];
        let where = `cc.site_id = $1`;

        if (actifFilter !== null) {
            params.push(actifFilter);
            where += ` AND cc.actif = $${params.length}`;
        }

        const result = await db.query(
            `
      SELECT
        cc.id,
        cc.site_id,
        cc.nom,
        cc.telephone,
        cc.observation,
        cc.actif,
        cc.deleted_at,
        cc.created_by,
        cc.created_at,
        cc.updated_at,
        COALESCE(SUM(
          CASE
            WHEN m.type_mvt IN ('credit', 'avance', 'ajustement_plus') THEN m.montant
            WHEN m.type_mvt IN ('remboursement', 'ajustement_moins') THEN -m.montant
            ELSE 0
          END
        ), 0) AS solde_courant
      FROM comptes_clients cc
      LEFT JOIN compte_client_mouvements m
        ON m.compte_client_id = cc.id
      WHERE ${where}
      GROUP BY
        cc.id, cc.site_id, cc.nom, cc.telephone, cc.observation,
        cc.actif, cc.deleted_at, cc.created_by, cc.created_at, cc.updated_at
      ORDER BY cc.nom ASC
      `,
            params
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Erreur liste comptes clients:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/comptes-clients
 */
router.post('/', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const createdBy = req.session.userId || null;
    const { nom, telephone, observation } = req.body;

    if (!nom || !String(nom).trim()) {
        return res.status(400).json({ erreur: 'Le nom du client est obligatoire.' });
    }

    try {
        const result = await db.query(
            `
      INSERT INTO comptes_clients (
        site_id,
        nom,
        telephone,
        observation,
        actif,
        deleted_at,
        created_by
      )
      VALUES ($1, $2, $3, $4, true, NULL, $5)
      RETURNING *
      `,
            [
                siteId,
                String(nom).trim(),
                telephone?.trim() || null,
                observation?.trim() || null,
                createdBy
            ]
        );

        res.status(201).json({
            ok: true,
            client: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur création compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PUT /api/comptes-clients/:id
 */
router.put('/:id', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const id = Number(req.params.id);
    const { nom, telephone, observation } = req.body;

    if (!id) {
        return res.status(400).json({ erreur: 'ID client invalide.' });
    }

    if (!nom || !String(nom).trim()) {
        return res.status(400).json({ erreur: 'Le nom du client est obligatoire.' });
    }

    try {
        const result = await db.query(
            `
      UPDATE comptes_clients
      SET nom = $1,
          telephone = $2,
          observation = $3,
          updated_at = NOW()
      WHERE id = $4
        AND site_id = $5
      RETURNING *
      `,
            [
                String(nom).trim(),
                telephone?.trim() || null,
                observation?.trim() || null,
                id,
                siteId
            ]
        );

        if (!result.rows.length) {
            return res.status(404).json({ erreur: 'Client introuvable.' });
        }

        res.json({
            ok: true,
            client: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur modification compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PUT /api/comptes-clients/:id/statut
 * Règle: impossible de désactiver un client si son solde n'est pas nul
 */
router.put('/:id/statut', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const id = Number(req.params.id);
    const actif = parseActif(req.body.actif);

    if (!id) {
        return res.status(400).json({ erreur: 'ID client invalide.' });
    }

    if (actif === null) {
        return res.status(400).json({ erreur: 'Valeur actif invalide.' });
    }

    try {
        const compte = await getCompteAvecSolde(siteId, id);

        if (!compte) {
            return res.status(404).json({ erreur: 'Client introuvable.' });
        }

        const solde = Number(compte.solde_courant || 0);

        if (actif === false && solde !== 0) {
            return res.status(400).json({
                erreur: `Impossible de désactiver ce client : son solde n'est pas nul (${solde}).`
            });
        }

        const result = await db.query(
            `
      UPDATE comptes_clients
      SET actif = $1,
          deleted_at = NULL,
          updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
      RETURNING *
      `,
            [actif, id, siteId]
        );

        res.json({
            ok: true,
            client: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur changement statut client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/comptes-clients/:id/mouvements
 */
router.post('/:id/mouvements', requireAuth, async (req, res) => {
    const siteId = req.session.siteId;
    const creePar = req.session.userId || null;
    const compteClientId = Number(req.params.id);
    const { type_mvt, montant, mode_paiement, note } = req.body;

    const typesValides = [
        'credit',
        'remboursement',
        'avance',
        'ajustement_plus',
        'ajustement_moins'
    ];

    if (!compteClientId) {
        return res.status(400).json({ erreur: 'ID client invalide.' });
    }

    if (!typesValides.includes(type_mvt)) {
        return res.status(400).json({ erreur: 'Type de mouvement invalide.' });
    }

    const montantInt = toPositiveInt(montant, -1);
    if (montantInt < 0) {
        return res.status(400).json({ erreur: 'Montant invalide.' });
    }

    try {
        const compte = await db.query(
            `
      SELECT id
      FROM comptes_clients
      WHERE id = $1
        AND site_id = $2
      `,
            [compteClientId, siteId]
        );

        if (!compte.rows.length) {
            return res.status(404).json({ erreur: 'Client introuvable.' });
        }

        const result = await db.query(
            `
      INSERT INTO compte_client_mouvements (
        compte_client_id,
        type_mvt,
        montant,
        mode_paiement,
        note,
        cree_par
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
      `,
            [
                compteClientId,
                type_mvt,
                montantInt,
                mode_paiement?.trim() || null,
                note?.trim() || null,
                creePar
            ]
        );

        res.status(201).json({
            ok: true,
            mouvement: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur création mouvement compte client:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

module.exports = router;