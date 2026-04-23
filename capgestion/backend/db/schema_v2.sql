-- ============================================================
-- CAPGESTION V2 — Schéma PostgreSQL
-- Socle métier : rapports, comptes clients, trésorerie, gaz, RH
-- ============================================================

-- ============================================================
-- SITES
-- ============================================================
CREATE TABLE sites (
  id           SERIAL PRIMARY KEY,
  nom          VARCHAR(100) NOT NULL,
  ville        VARCHAR(100),
  actif        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- EMPLOYES
-- Un employé n'est pas forcément un utilisateur connecté
-- ============================================================
CREATE TABLE employes (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id),
  nom             VARCHAR(120) NOT NULL,
  poste           VARCHAR(120),
  salaire_base    BIGINT NOT NULL DEFAULT 0 CHECK (salaire_base >= 0),
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMP NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- UTILISATEURS
-- Un utilisateur peut être lié à un employé, mais ce n'est pas obligatoire
-- ============================================================
CREATE TABLE utilisateurs (
  id                 SERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES sites(id),
  employe_id         INTEGER NULL REFERENCES employes(id),
  nom                VARCHAR(120) NOT NULL,
  email              VARCHAR(150) NOT NULL UNIQUE,
  mot_de_passe       VARCHAR(255) NOT NULL,
  role               VARCHAR(20) NOT NULL CHECK (role IN ('proprietaire','gerant')),
  actif              BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_pwd    BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at         TIMESTAMP NULL,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (employe_id)
);

-- ============================================================
-- PAIE MENSUELLE
-- Le net du mois = salaire_base_snapshot + bonus - retenues
-- Le total des nets alimente la ligne "salaires" des charges
-- ============================================================
CREATE TABLE salaires_mois (
  id                    SERIAL PRIMARY KEY,
  employe_id            INTEGER NOT NULL REFERENCES employes(id) ON DELETE CASCADE,
  mois                  DATE NOT NULL,
  salaire_base_snapshot BIGINT NOT NULL DEFAULT 0 CHECK (salaire_base_snapshot >= 0),
  bonus                 BIGINT NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  retenues              BIGINT NOT NULL DEFAULT 0 CHECK (retenues >= 0),
  salaire_net           BIGINT NOT NULL DEFAULT 0 CHECK (salaire_net >= 0),
  statut                VARCHAR(20) NOT NULL DEFAULT 'en_attente'
                        CHECK (statut IN ('en_attente','valide','paye')),
  observation           TEXT,
  cree_par              INTEGER NULL REFERENCES utilisateurs(id),
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (employe_id, mois)
);

-- ============================================================
-- COMPTES CLIENTS
-- Remplace la logique "credits" simple
-- Solde > 0  : le client nous doit
-- Solde < 0  : le client a une avance chez nous
-- ============================================================
CREATE TABLE comptes_clients (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id),
  nom             VARCHAR(120) NOT NULL,
  telephone       VARCHAR(40),
  observation     TEXT,
  actif           BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at      TIMESTAMP NULL,
  created_by      INTEGER NULL REFERENCES utilisateurs(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE compte_client_mouvements (
  id                SERIAL PRIMARY KEY,
  compte_client_id   INTEGER NOT NULL REFERENCES comptes_clients(id) ON DELETE CASCADE,
  date_mouvement     TIMESTAMP NOT NULL DEFAULT NOW(),
  type_mvt           VARCHAR(20) NOT NULL
                     CHECK (type_mvt IN (
                       'credit',
                       'remboursement',
                       'avance',
                       'ajustement_plus',
                       'ajustement_moins'
                     )),
  montant            BIGINT NOT NULL CHECK (montant > 0),
  mode_paiement      VARCHAR(50),
  note               TEXT,
  cree_par           INTEGER NULL REFERENCES utilisateurs(id),
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE VIEW v_comptes_clients_soldes AS
SELECT
  cc.id,
  cc.site_id,
  cc.nom,
  cc.telephone,
  cc.actif,
  cc.deleted_at,
  COALESCE(SUM(
    CASE
      WHEN m.type_mvt IN ('credit','ajustement_plus') THEN m.montant
      WHEN m.type_mvt IN ('remboursement','avance','ajustement_moins') THEN -m.montant
      ELSE 0
    END
  ), 0) AS solde_compte
FROM comptes_clients cc
LEFT JOIN compte_client_mouvements m
  ON m.compte_client_id = cc.id
GROUP BY cc.id, cc.site_id, cc.nom, cc.telephone, cc.actif, cc.deleted_at;

-- ============================================================
-- FONDS MOBILE MONEY DISPONIBLES (état courant)
-- ============================================================
CREATE TABLE fond_mm (
  id            SERIAL PRIMARY KEY,
  site_id       INTEGER NOT NULL REFERENCES sites(id) UNIQUE,
  orange_rev    BIGINT NOT NULL DEFAULT 0 CHECK (orange_rev >= 0),
  orange_pdv    BIGINT NOT NULL DEFAULT 0 CHECK (orange_pdv >= 0),
  orange_total  BIGINT NOT NULL DEFAULT 0 CHECK (orange_total >= 0),
  wave          BIGINT NOT NULL DEFAULT 0 CHECK (wave >= 0),
  mtn           BIGINT NOT NULL DEFAULT 0 CHECK (mtn >= 0),
  moov          BIGINT NOT NULL DEFAULT 0 CHECK (moov >= 0),
  moov_p2       BIGINT NOT NULL DEFAULT 0 CHECK (moov_p2 >= 0),
  tresor        BIGINT NOT NULL DEFAULT 0 CHECK (tresor >= 0),
  unites        BIGINT NOT NULL DEFAULT 0 CHECK (unites >= 0),
  especes       BIGINT NOT NULL DEFAULT 0 CHECK (especes >= 0),
  mis_a_jour    TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- FOND MM MIS A DISPOSITION PAR LE PROPRIETAIRE
-- ============================================================
CREATE TABLE fond_mm_proprietaire_mouvements (
  id             SERIAL PRIMARY KEY,
  site_id        INTEGER NOT NULL REFERENCES sites(id),
  date_mouvement TIMESTAMP NOT NULL DEFAULT NOW(),
  type_mvt       VARCHAR(10) NOT NULL CHECK (type_mvt IN ('appro','retrait')),
  montant        BIGINT NOT NULL CHECK (montant > 0),
  motif          TEXT,
  cree_par       INTEGER NULL REFERENCES utilisateurs(id),
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE VIEW v_fond_mm_mis_a_disposition AS
SELECT
  s.id AS site_id,
  COALESCE(SUM(
    CASE
      WHEN f.type_mvt = 'appro' THEN f.montant
      WHEN f.type_mvt = 'retrait' THEN -f.montant
      ELSE 0
    END
  ), 0) AS fond_mis_a_disposition
FROM sites s
LEFT JOIN fond_mm_proprietaire_mouvements f
  ON f.site_id = s.id
GROUP BY s.id;

-- ============================================================
-- GAZ — PARAMETRES ET ETAT COURANT
-- ============================================================
CREATE TABLE gaz_config (
  id                 SERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES sites(id) UNIQUE,
  b12_pleines        INTEGER NOT NULL DEFAULT 0 CHECK (b12_pleines >= 0),
  b12_vides          INTEGER NOT NULL DEFAULT 0 CHECK (b12_vides >= 0),
  b12_stock          INTEGER NOT NULL DEFAULT 0 CHECK (b12_stock >= 0),
  b6_pleines         INTEGER NOT NULL DEFAULT 0 CHECK (b6_pleines >= 0),
  b6_vides           INTEGER NOT NULL DEFAULT 0 CHECK (b6_vides >= 0),
  b6_stock           INTEGER NOT NULL DEFAULT 0 CHECK (b6_stock >= 0),
  b12_commission     INTEGER NOT NULL DEFAULT 450 CHECK (b12_commission >= 0),
  b6_commission      INTEGER NOT NULL DEFAULT 350 CHECK (b6_commission >= 0),
  b12_prix_vente     INTEGER NOT NULL DEFAULT 4950 CHECK (b12_prix_vente >= 0),
  b6_prix_vente      INTEGER NOT NULL DEFAULT 1850 CHECK (b6_prix_vente >= 0),
  b12_cout_recharge  INTEGER NOT NULL DEFAULT 4850 CHECK (b12_cout_recharge >= 0),
  b6_cout_recharge   INTEGER NOT NULL DEFAULT 1850 CHECK (b6_cout_recharge >= 0),
  mis_a_jour         TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE gaz_caisse_mouvements (
  id              SERIAL PRIMARY KEY,
  site_id         INTEGER NOT NULL REFERENCES sites(id),
  date_mouvement  TIMESTAMP NOT NULL DEFAULT NOW(),
  type_mvt        VARCHAR(20) NOT NULL
                  CHECK (type_mvt IN (
                    'vente',
                    'recharge',
                    'depense',
                    'ajustement_plus',
                    'ajustement_moins',
                    'appro',
                    'retrait'
                  )),
  montant         BIGINT NOT NULL CHECK (montant > 0),
  note            TEXT,
  cree_par        INTEGER NULL REFERENCES utilisateurs(id),
  created_at      TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE VIEW v_gaz_caisse_theorique AS
SELECT
  s.id AS site_id,
  COALESCE(SUM(
    CASE
      WHEN g.type_mvt IN ('vente','appro','ajustement_plus') THEN g.montant
      WHEN g.type_mvt IN ('recharge','depense','retrait','ajustement_moins') THEN -g.montant
      ELSE 0
    END
  ), 0) AS caisse_gaz_theorique
FROM sites s
LEFT JOIN gaz_caisse_mouvements g
  ON g.site_id = s.id
GROUP BY s.id;

-- ============================================================
-- RAPPORTS JOURNALIERS
-- ============================================================
CREATE TABLE rapports (
  id                 SERIAL PRIMARY KEY,
  site_id            INTEGER NOT NULL REFERENCES sites(id),
  gerant_id          INTEGER NOT NULL REFERENCES utilisateurs(id),
  date_rapport       DATE NOT NULL,
  observation        TEXT,
  statut             VARCHAR(20) NOT NULL DEFAULT 'envoye'
                     CHECK (statut IN ('envoye','valide','verrouille')),
  created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMP NOT NULL DEFAULT NOW(),
  last_modified_by   INTEGER NULL REFERENCES utilisateurs(id),
  UNIQUE (site_id, date_rapport)
);

CREATE TABLE rapport_soldes (
  id            SERIAL PRIMARY KEY,
  rapport_id    INTEGER NOT NULL REFERENCES rapports(id) ON DELETE CASCADE UNIQUE,
  orange_rev    BIGINT NOT NULL DEFAULT 0 CHECK (orange_rev >= 0),
  orange_pdv    BIGINT NOT NULL DEFAULT 0 CHECK (orange_pdv >= 0),
  wave          BIGINT NOT NULL DEFAULT 0 CHECK (wave >= 0),
  mtn           BIGINT NOT NULL DEFAULT 0 CHECK (mtn >= 0),
  moov          BIGINT NOT NULL DEFAULT 0 CHECK (moov >= 0),
  moov_p2       BIGINT NOT NULL DEFAULT 0 CHECK (moov_p2 >= 0),
  tresor        BIGINT NOT NULL DEFAULT 0 CHECK (tresor >= 0),
  unites        BIGINT NOT NULL DEFAULT 0 CHECK (unites >= 0),
  especes       BIGINT NOT NULL DEFAULT 0 CHECK (especes >= 0)
);

CREATE TABLE rapport_gaz (
  id               SERIAL PRIMARY KEY,
  rapport_id       INTEGER NOT NULL REFERENCES rapports(id) ON DELETE CASCADE UNIQUE,
  b12_vendues      INTEGER NOT NULL DEFAULT 0 CHECK (b12_vendues >= 0),
  b12_rechargees   INTEGER NOT NULL DEFAULT 0 CHECK (b12_rechargees >= 0),
  b12_fuites       INTEGER NOT NULL DEFAULT 0 CHECK (b12_fuites >= 0),
  b6_vendues       INTEGER NOT NULL DEFAULT 0 CHECK (b6_vendues >= 0),
  b6_rechargees    INTEGER NOT NULL DEFAULT 0 CHECK (b6_rechargees >= 0),
  b6_fuites        INTEGER NOT NULL DEFAULT 0 CHECK (b6_fuites >= 0)
);

CREATE TABLE rapport_depenses (
  id            SERIAL PRIMARY KEY,
  rapport_id    INTEGER NOT NULL REFERENCES rapports(id) ON DELETE CASCADE,
  description   VARCHAR(200) NOT NULL,
  montant       BIGINT NOT NULL CHECK (montant > 0)
);

CREATE TABLE rapport_modifications (
  id                SERIAL PRIMARY KEY,
  rapport_id         INTEGER NOT NULL REFERENCES rapports(id) ON DELETE CASCADE,
  modifie_par        INTEGER NOT NULL REFERENCES utilisateurs(id),
  motif              TEXT,
  created_at         TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ============================================================
-- CHARGES MENSUELLES
-- ============================================================
CREATE TABLE charges (
  id                  SERIAL PRIMARY KEY,
  site_id             INTEGER NOT NULL REFERENCES sites(id),
  mois                DATE NOT NULL,
  salaires            BIGINT NOT NULL DEFAULT 0 CHECK (salaires >= 0),
  loyer_local         BIGINT NOT NULL DEFAULT 0 CHECK (loyer_local >= 0),
  loyer_terrain       BIGINT NOT NULL DEFAULT 0 CHECK (loyer_terrain >= 0),
  telephone_internet  BIGINT NOT NULL DEFAULT 0 CHECK (telephone_internet >= 0),
  transport_gerante   BIGINT NOT NULL DEFAULT 0 CHECK (transport_gerante >= 0),
  mairie              BIGINT NOT NULL DEFAULT 0 CHECK (mairie >= 0),
  impots              BIGINT NOT NULL DEFAULT 0 CHECK (impots >= 0),
  cnps                BIGINT NOT NULL DEFAULT 0 CHECK (cnps >= 0),
  photocopie          BIGINT NOT NULL DEFAULT 0 CHECK (photocopie >= 0),
  tontine             BIGINT NOT NULL DEFAULT 0 CHECK (tontine >= 0),
  sodeci_cie          BIGINT NOT NULL DEFAULT 0 CHECK (sodeci_cie >= 0),
  aide_magasin        BIGINT NOT NULL DEFAULT 0 CHECK (aide_magasin >= 0),
  bonus               BIGINT NOT NULL DEFAULT 0 CHECK (bonus >= 0),
  autres_variables    BIGINT NOT NULL DEFAULT 0 CHECK (autres_variables >= 0),
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE (site_id, mois)
);

CREATE VIEW v_salaires_total_mois AS
SELECT
  e.site_id,
  sm.mois,
  COALESCE(SUM(sm.salaire_net), 0) AS total_salaires_nets
FROM salaires_mois sm
JOIN employes e
  ON e.id = sm.employe_id
GROUP BY e.site_id, sm.mois;

-- ============================================================
-- INDEX
-- ============================================================
CREATE INDEX idx_utilisateurs_site_role
  ON utilisateurs(site_id, role, actif);

CREATE INDEX idx_employes_site_actif
  ON employes(site_id, actif);

CREATE INDEX idx_salaires_mois_employe_mois
  ON salaires_mois(employe_id, mois);

CREATE INDEX idx_comptes_clients_site_actif
  ON comptes_clients(site_id, actif);

CREATE INDEX idx_compte_client_mouvements_compte_date
  ON compte_client_mouvements(compte_client_id, date_mouvement DESC);

CREATE INDEX idx_fond_mm_proprietaire_site_date
  ON fond_mm_proprietaire_mouvements(site_id, date_mouvement DESC);

CREATE INDEX idx_gaz_caisse_site_date
  ON gaz_caisse_mouvements(site_id, date_mouvement DESC);

CREATE INDEX idx_rapports_site_date
  ON rapports(site_id, date_rapport DESC);

CREATE INDEX idx_rapport_modifications_rapport_date
  ON rapport_modifications(rapport_id, created_at DESC);

CREATE INDEX idx_charges_site_mois
  ON charges(site_id, mois DESC);

-- ============================================================
-- DONNEES INITIALES MINIMALES
-- ============================================================
INSERT INTO sites (nom, ville)
VALUES ('Site principal', 'Abidjan');

INSERT INTO fond_mm (site_id)
VALUES (1);

INSERT INTO gaz_config (
  site_id,
  b12_pleines, b12_vides, b12_stock,
  b6_pleines,  b6_vides,  b6_stock
)
VALUES (
  1,
  0, 0, 0,
  0, 0, 0
);

INSERT INTO utilisateurs (site_id, nom, email, mot_de_passe, role)
VALUES
  (1, 'Propriétaire', 'patron@capgestion.ci', '$2b$10$placeholder_hash_proprietaire', 'proprietaire');
