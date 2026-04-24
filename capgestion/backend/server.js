require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const employesRoutes = require('./routes/employes');
const utilisateursRoutes = require('./routes/utilisateurs');
const comptesClientsRoutes = require('./routes/comptesClients');
const authRoutes = require('./routes/auth');
const rapportRoutes = require('./routes/rapports');
const creditRoutes = require('./routes/credits');
const chargeRoutes = require('./routes/charges');
const fondRoutes = require('./routes/fond');
const { attachUser } = require('./middleware/auth');
const dashboardRoutes = require('./routes/dashboard');
const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({ origin: true, credentials: true }));
app.use('/api/comptes-clients', comptesClientsRoutes);
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
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/api/utilisateurs', utilisateursRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/rapports', rapportRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/charges', chargeRoutes);
app.use('/api/fond', fondRoutes);
app.use('/api/employes', employesRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

app.listen(PORT, () => {
  console.log(`CAPGestion démarré sur le port ${PORT}`);
});

module.exports = app;
