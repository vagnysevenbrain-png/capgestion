cat /home/claude/capgestion/backend/routes/auth.js
Sortie

const express  = require('express');
const crypto   = require('crypto');
const db       = require('../db');
const router   = express.Router();

// Vérifie un mot de passe contre un hash pbkdf2:sha256:iterations:salt:hash
async function verifierMotDePasse(motDePasse, hashStocke) {
  try {
    if (hashStocke.startsWith('pbkdf2:')) {
      const parties     = hashStocke.split(':');
      const iterations  = parseInt(parties[2]);
      const salt        = parties[3];
      const hashAttendu = parties[4];
      return new Promise((resolve) => {
        crypto.pbkdf2(motDePasse, salt, iterations, 32, 'sha256', (err, buf) => {
          if (err) return resolve(false);
          resolve(buf.toString('hex') === hashAttendu);
        });
      });
    }
    const bcrypt = require('bcrypt');
    return await bcrypt.compare(motDePasse, hashStocke);
  } catch { return false; }
}

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, mot_de_passe } = req.body;
  if (!email || !mot_de_passe) {
    return res.status(400).json({ erreur: 'Email et mot de passe requis.' });
  }
  try {
    const result = await db.query(
      'SELECT * FROM utilisateurs WHERE email = $1 AND actif = TRUE',
      [email.toLowerCase().trim()]
    );
    if (result.rows.length === 0) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
    }
    const user = result.rows[0];
    const valide = await verifierMotDePasse(mot_de_passe, user.mot_de_passe);
    if (!valide) {
      return res.status(401).json({ erreur: 'Email ou mot de passe incorrect.' });
    }
    req.session.userId = user.id;
    req.session.role   = user.role;
    req.session.siteId = user.site_id;
    req.session.nom    = user.nom;
    res.json({
      ok: true,
      utilisateur: { id: user.id, nom: user.nom, role: user.role, site_id: user.site_id }
    });
  } catch (err) {
    console.error('Erreur login:', err);
    res.status(500).json({ erreur: 'Erreur serveur.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

// GET /api/auth/moi — infos utilisateur connecté
router.get('/moi', (req, res) => {
  if (!req.session?.userId) {
    return res.status(401).json({ connecte: false });
  }
  res.json({
    connecte: true,
    utilisateur: {
      id:      req.session.userId,
      nom:     req.session.nom,
      role:    req.session.role,
      site_id: req.session.siteId
    }
  });
});

module.exports = router;
