// Vérifie que l'utilisateur est connecté
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ erreur: 'Non connecté. Veuillez vous identifier.' });
  }
  next();
}

// Vérifie que l'utilisateur est propriétaire
function requireProprietaire(req, res, next) {
  if (!req.session || req.session.role !== 'proprietaire') {
    return res.status(403).json({ erreur: 'Accès réservé au propriétaire.' });
  }
  next();
}

// Attache les infos utilisateur à chaque requête
function attachUser(req, res, next) {
  res.locals.userId  = req.session?.userId;
  res.locals.role    = req.session?.role;
  res.locals.siteId  = req.session?.siteId;
  res.locals.nomUser = req.session?.nom;
  next();
}

module.exports = { requireAuth, requireProprietaire, attachUser };
