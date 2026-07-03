# Securite : journal d'audit et approbations

Ce chapitre couvre la page **Securite**, un menu distinct de Supervision mais qui en complete etroitement le suivi : c'est ici que se trouve la tracabilite fine de toutes les actions sensibles effectuees sur l'installation.

## Acces

La page **Security** (route `/admin/security`) est une entree de navigation a part entiere, **separee** de la page Supervision. Contrairement a Supervision, elle est **strictement reservee aux comptes administrateur** : il n'existe pas de capacite d'equipe permettant a un utilisateur non-administrateur d'y acceder, meme partiellement.

Elle comporte deux onglets : **Audit log** et **Approvals**.

## Onglet Audit log â€” ce qui est trace

Chaque entree du journal d'audit enregistre :

- le **tenant** concerne ;
- l'**utilisateur** a l'origine de l'action (nom) ;
- l'**appareil** concerne, quand applicable ;
- l'**action** effectuee (par exemple : demarrage d'une session distante par protocole, purge du journal d'audit, etc.) ;
- la **ressource** touchee, resolue en nom lisible plutot qu'en identifiant technique (script, scenario, equipe, utilisateur, groupe, cle API, tenant, planification, politique de conformite...) ;
- un bloc de **details** libre (au format brut), pour retrouver le contexte exact de l'action ;
- l'**adresse IP** d'origine ;
- la **date/heure** precise.

Pour chaque entree, la table affiche : la date/heure, le tenant (colonne visible uniquement en vue tenant master), l'action effectuee, l'utilisateur, l'appareil concerne, la ressource touchee et l'adresse IP d'origine. Chaque ligne peut etre **depliee** pour afficher le detail brut de l'evenement quand un contenu supplementaire est disponible.

## Onglet Audit log â€” recherche et filtres

La page propose :

- une **recherche texte** libre ;
- un **filtre par action**, les actions etant regroupees par famille (par exemple toutes les actions liees aux utilisateurs, prefixees de la meme facon) ;
- un **filtre par utilisateur** (liste deroulante avec recherche) ;
- un **filtre par plage de dates** (Since / Until) ;
- un **export CSV** de la vue filtree ;
- un bouton **Clear** pour vider integralement le journal du tenant courant.

En vue **tenant master**, une colonne Tenant supplementaire apparait et un filtre mono-selection par tenant permet de se concentrer sur une entite a la fois ; sans ce filtre, la vue master affiche par defaut le journal de **toute l'installation**, tous tenants confondus.

## Vider le journal d'audit

Le bouton **Clear** declenche une demande de confirmation avant toute suppression, rappelant qu'une purge complete du journal d'audit du tenant est une action sensible et definitive.

Cette action est protegee par le systeme de restrictions a double validation, et son niveau **par defaut est "Restricted"** â€” c'est-a-dire qu'une purge du journal d'audit necessite par defaut l'approbation d'un **second administrateur** avant de s'executer reellement, sans qu'aucune configuration supplementaire ne soit necessaire (contrairement au demarrage de session distante, dont la restriction equivalente est desactivee par defaut).

Meme apres une purge validee, **une entree unique est automatiquement reinseree** dans le journal desormais vide, indiquant qui a vide le journal, quand, et combien d'entrees ont ete supprimees. Il est donc impossible de faire disparaitre totalement la trace d'une purge du journal d'audit.

## Onglet Approvals

Cet onglet regroupe les demandes en attente generees par le systeme de restrictions a double validation lorsque celui-ci est configure en mode **Restricted** pour une action donnee. C'est notamment ici que se traiterait une demande de purge du journal d'audit (restriction active par defaut), ou une demande de demarrage de session distante si un administrateur a explicitement active cette restriction pour son tenant. En pratique, tant qu'aucune restriction supplementaire n'est configuree au-dela des reglages par defaut, l'essentiel des actions administratives s'execute directement sans passer par cet onglet.