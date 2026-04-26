const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireProprietaire } = require('../middleware/auth');

const router = express.Router();

function parseActif(value) {
    if (value === true || value === 'true' || value === 1 || value === '1') return true;
    if (value === false || value === 'false' || value === 0 || value === '0') return false;
    return null;
}

/**
 * GET /api/utilisateurs
 */
router.get('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const actifFilter = parseActif(req.query.actif);

    try {
        const params = [siteId];
        let where = `u.site_id = $1 AND u.deleted_at IS NULL`;

        if (actifFilter !== null) {
            params.push(actifFilter);
            where += ` AND u.actif = $${params.length}`;
        }

        const result = await db.query(
            `
      SELECT
        u.id,
        u.site_id,
        u.employe_id,
        u.nom,
        u.email,
        u.role,
        u.actif,
        u.must_change_pwd,
        u.created_at,
        u.updated_at
      FROM utilisateurs u
      WHERE ${where}
      ORDER BY u.nom ASC
      `,
            params
        );

        res.json(result.rows);
    } catch (err) {
        console.error('Erreur liste utilisateurs:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * POST /api/utilisateurs
 */
router.post('/', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const { nom, email, mot_de_passe, role, employe_id } = req.body;

    if (!nom || !String(nom).trim()) {
        return res.status(400).json({ erreur: 'Le nom est obligatoire.' });
    }

    if (!email || !String(email).trim()) {
        return res.status(400).json({ erreur: 'L’email est obligatoire.' });
    }

    if (!mot_de_passe || String(mot_de_passe).length < 6) {
        return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères.' });
    }

    if (!['proprietaire', 'gerant'].includes(role)) {
        return res.status(400).json({ erreur: 'Rôle invalide.' });
    }

    try {
        const emailNorm = String(email).trim().toLowerCase();

        const emailCheck = await db.query(
            `SELECT id FROM utilisateurs WHERE email = $1`,
            [emailNorm]
        );
        if (emailCheck.rows.length) {
            return res.status(409).json({ erreur: 'Cet email existe déjà.' });
        }

        if (employe_id) {
            const employeCheck = await db.query(
                `
        SELECT id
        FROM employes
        WHERE id = $1
          AND site_id = $2
        `,
                [Number(employe_id), siteId]
            );

            if (!employeCheck.rows.length) {
                return res.status(400).json({ erreur: 'Employé lié introuvable.' });
            }
        }

        const hash = await bcrypt.hash(String(mot_de_passe), 10);

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
      VALUES ($1,$2,$3,$4,$5,$6,true,false)
      RETURNING id, site_id, employe_id, nom, email, role, actif, must_change_pwd, created_at, updated_at
      `,
            [
                siteId,
                employe_id ? Number(employe_id) : null,
                String(nom).trim(),
                emailNorm,
                hash,
                role
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
 * PUT /api/utilisateurs/:id
 */
router.put('/:id', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const id = Number(req.params.id);
    const { nom, email, mot_de_passe, role, employe_id } = req.body;

    if (!id) {
        return res.status(400).json({ erreur: 'ID utilisateur invalide.' });
    }

    if (!nom || !String(nom).trim()) {
        return res.status(400).json({ erreur: 'Le nom est obligatoire.' });
    }

    if (!email || !String(email).trim()) {
        return res.status(400).json({ erreur: 'L’email est obligatoire.' });
    }

    if (!['proprietaire', 'gerant'].includes(role)) {
        return res.status(400).json({ erreur: 'Rôle invalide.' });
    }

    try {
        const emailNorm = String(email).trim().toLowerCase();

        const currentRes = await db.query(
            `
      SELECT *
      FROM utilisateurs
      WHERE id = $1
        AND site_id = $2
      `,
            [id, siteId]
        );

        if (!currentRes.rows.length) {
            return res.status(404).json({ erreur: 'Utilisateur introuvable.' });
        }

        const current = currentRes.rows[0];

        const emailCheck = await db.query(
            `
      SELECT id
      FROM utilisateurs
      WHERE email = $1
        AND id <> $2
      `,
            [emailNorm, id]
        );
        if (emailCheck.rows.length) {
            return res.status(409).json({ erreur: 'Cet email existe déjà.' });
        }

        if (employe_id) {
            const employeCheck = await db.query(
                `
        SELECT id
        FROM employes
        WHERE id = $1
          AND site_id = $2
        `,
                [Number(employe_id), siteId]
            );

            if (!employeCheck.rows.length) {
                return res.status(400).json({ erreur: 'Employé lié introuvable.' });
            }

            const employeUnique = await db.query(
                `
        SELECT id
        FROM utilisateurs
        WHERE employe_id = $1
          AND id <> $2
        `,
                [Number(employe_id), id]
            );

            if (employeUnique.rows.length) {
                return res.status(409).json({ erreur: 'Cet employé est déjà lié à un autre utilisateur.' });
            }
        }

        let passwordHash = current.mot_de_passe;
        if (mot_de_passe && String(mot_de_passe).trim()) {
            if (String(mot_de_passe).length < 6) {
                return res.status(400).json({ erreur: 'Le mot de passe doit contenir au moins 6 caractères.' });
            }
            passwordHash = await bcrypt.hash(String(mot_de_passe), 10);
        }

        const result = await db.query(
            `
      UPDATE utilisateurs
      SET employe_id = $1,
          nom = $2,
          email = $3,
          mot_de_passe = $4,
          role = $5,
          updated_at = NOW()
      WHERE id = $6
        AND site_id = $7
      RETURNING id, site_id, employe_id, nom, email, role, actif, must_change_pwd, created_at, updated_at
      `,
            [
                employe_id ? Number(employe_id) : null,
                String(nom).trim(),
                emailNorm,
                passwordHash,
                role,
                id,
                siteId
            ]
        );

        res.json({
            ok: true,
            utilisateur: result.rows[0]
        });
    } catch (err) {
        console.error('Erreur modification utilisateur:', err);
        res.status(500).json({ erreur: 'Erreur serveur.' });
    }
});

/**
 * PUT /api/utilisateurs/:id/statut
 */
router.put('/:id/statut', requireAuth, requireProprietaire, async (req, res) => {
    const siteId = req.session.siteId;
    const currentUserId = req.session.userId || null;
    const id = Number(req.params.id);
    const actif = parseActif(req.body.actif);

    if (!id) {
        return res.status(400).json({ erreur: 'ID utilisateur invalide.' });
    }

    if (actif === null) {
        return res.status(400).json({ erreur: 'Valeur actif invalide.' });
    }

    if (currentUserId && id === currentUserId && actif === false) {
        return res.status(400).json({ erreur: 'Tu ne peux pas désactiver ton propre compte.' });
    }

    try {
        const result = await db.query(
            `
      UPDATE utilisateurs
      SET actif = $1,
          deleted_at = CASE WHEN $1 = false THEN NOW() ELSE NULL END,
          updated_at = NOW()
      WHERE id = $2
        AND site_id = $3
      RETURNING id, site_id, employe_id, nom, email, role, actif, must_change_pwd, created_at, updated_at
      `,
            [actif, id, siteId]
        );

        if (!result.rows.length) {
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

module.exports = router;