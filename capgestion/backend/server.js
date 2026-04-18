require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors    = require('cors');
const path    = require('path');

const authRoutes    = require('./routes/auth');
const rapportRoutes = require('./routes/rapports');
const creditRoutes  = require('./routes/credits');
const chargeRoutes  = require('./routes/charges');
const { attachUser } = require('./middleware/auth');

const app  = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));

app.use(session({
  secret:            process.env.SESSION_SECRET || 'dev_secret_changez_moi',
  resave:            false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    maxAge:   8 * 60 * 60 * 1000   // 8 heures
  }
}));

app.use(attachUser);

// Servir le frontend (fichiers statiques)
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes API
app.use('/api/auth',    authRoutes);
app.use('/api/rapports', rapportRoutes);
app.use('/api/credits',  creditRoutes);
app.use('/api/charges',  chargeRoutes);

// Toutes les autres routes → page principale (SPA)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// Démarrage
app.listen(PORT, () => {
  console.log(`CAPGestion démarré sur le port ${PORT}`);
});

module.exports = app;
