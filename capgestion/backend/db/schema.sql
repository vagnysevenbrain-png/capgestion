-- CAPGestion — Schéma base de données PostgreSQL
-- Version 1.0

-- ============================================================
-- SITES
-- ============================================================
CREATE TABLE sites (
  id          SERIAL PRIMARY KEY,
  nom         VARCHAR(100) NOT NULL,
  ville       VARCHAR(100),
  actif       BOOLEAN DEFAULT TRUE,
  created_at  TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- UTILISATEURS
-- ============================================================
CREATE TABLE utilisateurs (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  nom           VARCHAR(100) NOT NULL,
  email         VARCHAR(150) UNIQUE NOT NULL,
  mot_de_passe  VARCHAR(255) NOT NULL,  -- bcrypt hash
  role          VARCHAR(20) NOT NULL CHECK (role IN ('proprietaire', 'gerant')),
  actif         BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- RAPPORTS JOURNALIERS
-- ============================================================
CREATE TABLE rapports (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  gerant_id     INTEGER REFERENCES utilisateurs(id),
  date_rapport  DATE NOT NULL,
  observation   TEXT,
  statut        VARCHAR(20) DEFAULT 'envoye' CHECK (statut IN ('envoye', 'valide')),
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (site_id, date_rapport)
);

-- Soldes Mobile Money du jour
CREATE TABLE rapport_soldes (
  id            SERIAL PRIMARY KEY,
  rapport_id    INTEGER REFERENCES rapports(id) ON DELETE CASCADE,
  orange_rev    BIGINT DEFAULT 0,   -- Puce Revendeur
  orange_pdv    BIGINT DEFAULT 0,   -- Puce PDV
  wave          BIGINT DEFAULT 0,
  mtn           BIGINT DEFAULT 0,
  moov          BIGINT DEFAULT 0,
  tresor        BIGINT DEFAULT 0,
  especes       BIGINT DEFAULT 0
);

-- Mouvements gaz du jour
CREATE TABLE rapport_gaz (
  id            SERIAL PRIMARY KEY,
  rapport_id    INTEGER REFERENCES rapports(id) ON DELETE CASCADE,
  b12_vendues   INTEGER DEFAULT 0,
  b12_rechargees INTEGER DEFAULT 0,
  b12_fuites    INTEGER DEFAULT 0,
  b6_vendues    INTEGER DEFAULT 0,
  b6_rechargees INTEGER DEFAULT 0,
  b6_fuites     INTEGER DEFAULT 0
);

-- Dépenses du jour
CREATE TABLE rapport_depenses (
  id            SERIAL PRIMARY KEY,
  rapport_id    INTEGER REFERENCES rapports(id) ON DELETE CASCADE,
  description   VARCHAR(200) NOT NULL,
  montant       BIGINT NOT NULL
);

-- ============================================================
-- MOBILE MONEY — SAISIE MENSUELLE
-- ============================================================
CREATE TABLE mm_mensuel (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  mois          DATE NOT NULL,          -- 1er du mois ex: 2026-04-01
  orange_total  BIGINT DEFAULT 0,       -- somme rev + pdv
  wave          BIGINT DEFAULT 0,
  mtn           BIGINT DEFAULT 0,
  moov          BIGINT DEFAULT 0,
  tresor        BIGINT DEFAULT 0,
  unites        BIGINT DEFAULT 0,
  dep_carburant BIGINT DEFAULT 0,
  dep_materiel  BIGINT DEFAULT 0,
  dep_reparation BIGINT DEFAULT 0,
  dep_police    BIGINT DEFAULT 0,
  dep_fuites_gaz BIGINT DEFAULT 0,
  dep_autres    BIGINT DEFAULT 0,
  created_at    TIMESTAMP DEFAULT NOW(),
  UNIQUE (site_id, mois)
);

-- ============================================================
-- FOND MOBILE MONEY
-- ============================================================
CREATE TABLE fond_mm (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  orange        BIGINT DEFAULT 0,
  wave          BIGINT DEFAULT 0,
  mtn           BIGINT DEFAULT 0,
  moov          BIGINT DEFAULT 0,
  tresor        BIGINT DEFAULT 0,
  mis_a_jour    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- GAZ — STOCK ET CONFIGURATION
-- ============================================================
CREATE TABLE gaz_config (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER REFERENCES sites(id) UNIQUE,
  b12_stock       INTEGER DEFAULT 0,
  b6_stock        INTEGER DEFAULT 0,
  b12_commission  INTEGER DEFAULT 450,
  b6_commission   INTEGER DEFAULT 350,
  b12_prix_vente  INTEGER DEFAULT 4950,
  b6_prix_vente   INTEGER DEFAULT 1850,
  mis_a_jour      TIMESTAMP DEFAULT NOW()
);

-- Mouvements de stock gaz (hors rapports journaliers)
CREATE TABLE gaz_mouvements (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  type_mvt      VARCHAR(20) NOT NULL CHECK (type_mvt IN ('recharge','vente','fuite','livraison')),
  type_bouteille VARCHAR(5) NOT NULL CHECK (type_bouteille IN ('B12','B6')),
  quantite      INTEGER NOT NULL,
  date_mvt      DATE NOT NULL,
  observation   TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- CRÉDITS CLIENTS
-- ============================================================
CREATE TABLE credits (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  nom           VARCHAR(100) NOT NULL,
  telephone     VARCHAR(30),
  operateur     VARCHAR(50),
  montant       BIGINT NOT NULL,
  rembourse     BIGINT DEFAULT 0,
  echeance      DATE,
  observation   TEXT,
  statut        VARCHAR(20) DEFAULT 'en_cours' CHECK (statut IN ('en_cours', 'solde')),
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE credit_mouvements (
  id            SERIAL PRIMARY KEY,
  credit_id     INTEGER REFERENCES credits(id) ON DELETE CASCADE,
  type_mvt      VARCHAR(10) NOT NULL CHECK (type_mvt IN ('credit','remb')),
  montant       BIGINT NOT NULL,
  mode_paiement VARCHAR(50),
  note          TEXT,
  created_at    TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- CHARGES MENSUELLES (propriétaire uniquement)
-- ============================================================
CREATE TABLE charges (
  id                  SERIAL PRIMARY KEY,
  site_id             INTEGER REFERENCES sites(id),
  mois                DATE NOT NULL,
  -- Fixes
  salaires            BIGINT DEFAULT 0,
  loyer_local         BIGINT DEFAULT 0,
  loyer_terrain       BIGINT DEFAULT 0,
  telephone_internet  BIGINT DEFAULT 0,
  transport_gerante   BIGINT DEFAULT 0,
  mairie              BIGINT DEFAULT 0,
  impots              BIGINT DEFAULT 0,
  cnps                BIGINT DEFAULT 0,
  photocopie          BIGINT DEFAULT 0,
  -- Variables
  tontine             BIGINT DEFAULT 0,
  sodeci_cie          BIGINT DEFAULT 0,
  aide_magasin        BIGINT DEFAULT 0,
  bonus               BIGINT DEFAULT 0,
  autres_variables    BIGINT DEFAULT 0,
  created_at          TIMESTAMP DEFAULT NOW(),
  UNIQUE (site_id, mois)
);

-- Détail salaires par employé
CREATE TABLE employes (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER REFERENCES sites(id),
  nom           VARCHAR(100) NOT NULL,
  poste         VARCHAR(100),
  salaire_base  BIGINT DEFAULT 0,
  actif         BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMP DEFAULT NOW()
);

CREATE TABLE salaires_mois (
  id            SERIAL PRIMARY KEY,
  employe_id    INTEGER REFERENCES employes(id),
  mois          DATE NOT NULL,
  salaire       BIGINT NOT NULL,
  bonus         BIGINT DEFAULT 0,
  statut        VARCHAR(20) DEFAULT 'en_attente' CHECK (statut IN ('en_attente','paye')),
  UNIQUE (employe_id, mois)
);

-- ============================================================
-- INDEX pour performance
-- ============================================================
CREATE INDEX idx_rapports_site_date ON rapports(site_id, date_rapport DESC);
CREATE INDEX idx_credits_site ON credits(site_id, statut);
CREATE INDEX idx_mm_mensuel_site ON mm_mensuel(site_id, mois DESC);
CREATE INDEX idx_charges_site ON charges(site_id, mois DESC);

-- ============================================================
-- DONNÉES INITIALES
-- ============================================================
INSERT INTO sites (nom, ville) VALUES ('Site principal', 'Abidjan');

INSERT INTO utilisateurs (site_id, nom, email, mot_de_passe, role) VALUES
  (1, 'Propriétaire', 'patron@capgestion.ci', '$2b$10$placeholder_hash_proprietaire', 'proprietaire'),
  (1, 'Angèle', 'angele@capgestion.ci',  '$2b$10$placeholder_hash_gerante',     'gerant');

INSERT INTO gaz_config (site_id, b12_stock, b6_stock) VALUES (1, 90, 195);
INSERT INTO fond_mm (site_id) VALUES (1);
