--
-- PostgreSQL database dump
--

\restrict PSR0KVY15v3QoeCJemgFjGhhiHZbq1v7BVIQ1Ubdg0HBr2OxicSkhmYZPfwksTy

-- Dumped from database version 18.3 (Debian 18.3-1.pgdg12+1)
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: fond_mm; Type: TABLE DATA; Schema: public; Owner: capgestion_v2_db_user
--

COPY public.fond_mm (id, site_id, orange_rev, orange_pdv, orange_total, wave, mtn, moov, moov_p2, tresor, unites, especes, mis_a_jour) FROM stdin;
1	1	0	0	0	0	0	0	0	0	0	0	2026-04-23 22:45:30.289276
\.


--
-- Data for Name: mm_mensuel; Type: TABLE DATA; Schema: public; Owner: capgestion_v2_db_user
--

COPY public.mm_mensuel (id, site_id, mois, orange_total, wave, mtn, moov, tresor, unites, created_at, updated_at) FROM stdin;
1	1	2026-04-01	110400	236000	33500	9000	0	800	2026-04-25 00:26:52.839899	2026-04-25 00:26:52.839899
\.


--
-- Data for Name: rapports; Type: TABLE DATA; Schema: public; Owner: capgestion_v2_db_user
--

COPY public.rapports (id, site_id, gerant_id, date_rapport, observation, statut, created_at, updated_at, last_modified_by) FROM stdin;
1	1	1	2026-04-24	\N	envoye	2026-04-24 18:40:43.116515	2026-04-24 18:40:43.116515	1
3	1	1	2026-04-25	\N	envoye	2026-04-24 19:49:14.772357	2026-04-24 19:49:14.772357	1
\.


--
-- Data for Name: rapport_depenses; Type: TABLE DATA; Schema: public; Owner: capgestion_v2_db_user
--

COPY public.rapport_depenses (id, rapport_id, description, montant) FROM stdin;
1	1	eau de javel	1000
2	1	chiffon	500
\.


--
-- Data for Name: rapport_gaz; Type: TABLE DATA; Schema: public; Owner: capgestion_v2_db_user
--

COPY public.rapport_gaz (id, rapport_id, b12_vendues, b12_rechargees, b12_fuites, b6_vendues, b6_rechargees, b6_fuites, caisse_gaz_disponible) FROM stdin;
1	1	5	0	0	4	0	0	348000
2	3	5	0	0	4	0	0	382750
\.


--
-- Data for Name: rapport_soldes; Type: TABLE DATA; Schema: public; Owner: capgestion_v2_db_user
--

COPY public.rapport_soldes (id, rapport_id, orange_rev, orange_pdv, wave, mtn, moov, moov_p2, tresor, unites, especes) FROM stdin;
1	1	0	18889	1566734	211802	39473	208750	14223	4681	0
2	3	0	18889	1566734	211802	39473	208750	14223	4681	103600
\.


--
-- Name: fond_mm_id_seq; Type: SEQUENCE SET; Schema: public; Owner: capgestion_v2_db_user
--

SELECT pg_catalog.setval('public.fond_mm_id_seq', 1, true);


--
-- Name: mm_mensuel_id_seq; Type: SEQUENCE SET; Schema: public; Owner: capgestion_v2_db_user
--

SELECT pg_catalog.setval('public.mm_mensuel_id_seq', 1, true);


--
-- Name: rapport_depenses_id_seq; Type: SEQUENCE SET; Schema: public; Owner: capgestion_v2_db_user
--

SELECT pg_catalog.setval('public.rapport_depenses_id_seq', 2, true);


--
-- Name: rapport_gaz_id_seq; Type: SEQUENCE SET; Schema: public; Owner: capgestion_v2_db_user
--

SELECT pg_catalog.setval('public.rapport_gaz_id_seq', 2, true);


--
-- Name: rapport_soldes_id_seq; Type: SEQUENCE SET; Schema: public; Owner: capgestion_v2_db_user
--

SELECT pg_catalog.setval('public.rapport_soldes_id_seq', 2, true);


--
-- Name: rapports_id_seq; Type: SEQUENCE SET; Schema: public; Owner: capgestion_v2_db_user
--

SELECT pg_catalog.setval('public.rapports_id_seq', 3, true);


--
-- PostgreSQL database dump complete
--

\unrestrict PSR0KVY15v3QoeCJemgFjGhhiHZbq1v7BVIQ1Ubdg0HBr2OxicSkhmYZPfwksTy

