require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const rapportRoutes = require('./routes/rapports');
const creditRoutes = require('./routes/credits');
const chargeRoutes = require('./routes/charges');
const fondRoutes = require('./routes/fond');

const comptesClientsRoutes = require('./routes/comptesClients');
const utilisateursRoutes = require('./routes/utilisateurs');
const employesRoutes = require('./routes/employes');
const dashboardRoutes = require('./routes/dashboard');

const { attachUser } = require('./middleware/auth');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));

// IMPORTANT : la session doit être déclarée AVANT les routes API
app.use(session({
  name: 'capgestion.sid',
  secret: process.env.SESSION_SECRET || 'dev_secret_changez_moi',
  resave: false,
  saveUninitialized: false,
  proxy: true,
  cookie: {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use(attachUser);

// Fichiers statiques frontend
app.use(express.static(path.join(__dirname, '../frontend')));

// Routes API
app.use('/api/auth', authRoutes);
app.use('/api/rapports', rapportRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/charges', chargeRoutes);
app.use('/api/fond', fondRoutes);

app.use('/api/comptes-clients', comptesClientsRoutes);
app.use('/api/utilisateurs', utilisateursRoutes);
app.use('/api/employes', employesRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`CAPGestion démarré sur le port ${PORT}`);
});

module.exports = app;