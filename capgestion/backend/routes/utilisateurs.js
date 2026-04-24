const express = require('express');
const bcrypt = require('bcrypt');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/utilisateurs
 * Liste des utilisateurs du site
 * Réservé au propriétaire
 */
router.get('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;

    try {
        const result = await db.query(
            `
      SELECT
        id,
        site_id,
        employe_id,
        nom,
        email,
        role,
        actif,
        must_change_pwd,
        deleted_at,
        created_at
      FROM utilisateurs
      WHERE site_id = $1
        AND deleted_at IS NULL
      ORDER BY created_at DESC, nom ASC
      `,
            [siteId]
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Erreur liste utilisateurs:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/utilisateurs
 * Créer un gérant
 * Réservé au propriétaire
 */
router.post('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { nom, email, mot_de_passe, role, employe_id } = req.body;

    if (!nom || !nom.trim()) {
        return res.status(400).json({ erreur: 'Nom requis.' });
    }

    if (!email || !email.trim()) {
        return res.status(400).json({ erreur: 'Email requis.' });
    }

    if (!mot_de_passe || mot_de_passe.length < 6) {
        return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 6 caractères).' });
    }

    const roleFinal = role || 'gerant';

    if (!['gerant', 'proprietaire'].includes(roleFinal)) {
        return res.status(400).json({ erreur: 'Rôle invalide.' });
    }

    try {
        const emailNormalise = email.trim().toLowerCase();

        const existe = await db.query(
            `SELECT id FROM utilisateurs WHERE email = $1`,
            [emailNormalise]
        );

        if (existe.rows.length > 0) {
            return res.status(409).json({ erreur: 'Cet email existe déjà.' });
        }

        const hash = await bcrypt.hash(mot_de_passe, 10);

        const result = await db.query(
            `
      INSERT INTO utilisateurs (
        site_id,
        employe_id,
        nom,
        email,
        mot_de_passe,
        role,
        actif,
        must_change_pwd
      )
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, FALSE)
      RETURNING id, nom, email, role, actif, created_at
      `,
            [
                siteId,
                employe_id || null,
                nom.trim(),
                emailNormalise,
                hash,
                roleFinal
            ]
        );

        res.status(201).json({
            ok: true,
            utilisateur: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur création utilisateur:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PATCH /api/utilisateurs/:id/statut
 * Activer / désactiver un utilisateur
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
      UPDATE utilisateurs
      SET actif = $1, updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
        AND deleted_at IS NULL
      RETURNING id, nom, email, role, actif
      `,
            [actif, id, siteId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
        }

        res.json({
            ok: true,
            utilisateur: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur changement statut utilisateur:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PATCH /api/utilisateurs/:id/reset-password
 * Réinitialiser le mot de passe
 * Réservé au propriétaire
 */
router.patch('/:id/reset-password', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;
    const { mot_de_passe } = req.body;

    if (!mot_de_passe || mot_de_passe.length < 6) {
        return res.status(400).json({ erreur: 'Mot de passe trop court (minimum 6 caractères).' });
    }

    try {
        const hash = await bcrypt.hash(mot_de_passe, 10);

        const result = await db.query(
            `
      UPDATE utilisateurs
      SET mot_de_passe = $1,
          must_change_pwd = FALSE,
          updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
        AND deleted_at IS NULL
      RETURNING id, nom, email
      `,
            [hash, id, siteId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
        }

        res.json({
            ok: true,
            utilisateur: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur reset mot de passe:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * DELETE /api/utilisateurs/:id
 * Suppression logique
 * Réservé au propriétaire
 */
router.delete('/:id', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { id } = req.params;

    try {
        const result = await db.query(
            `
      UPDATE utilisateurs
      SET deleted_at = NOW(),
          actif = FALSE,
          updated_at = NOW()
      WHERE id = $1
        AND site_id = $2
        AND deleted_at IS NULL
      RETURNING id, nom, email
      `,
            [id, siteId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
        }

        res.json({
            ok: true,
            message: 'Utilisateur supprimé.',
            utilisateur: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur suppression utilisateur:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

module.exports = router;