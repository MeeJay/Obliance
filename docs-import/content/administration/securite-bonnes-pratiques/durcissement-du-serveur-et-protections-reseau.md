Ce guide couvre la configuration reseau et serveur recommandee pour exploiter Obliance en production de maniere securisee : HTTPS, gestion des sessions et protections anti-abus integrees.

## HTTPS obligatoire en production

En environnement de production, le cookie de session est marque systematiquement **secure**, ce qui signifie que le navigateur ne le transmettra que sur une connexion HTTPS. **Une installation Obliance en production doit donc imperativement etre servie en HTTPS**, faute de quoi les utilisateurs ne pourront pas rester connectes correctement.

Dans une configuration classique, Obliance est place derriere un reverse proxy qui termine le TLS (par exemple Nginx ou Nginx Proxy Manager). Le serveur est concu pour fonctionner derriere ce type de proxy, ce qui lui permet de determiner correctement l'origine reelle des requetes et d'appliquer les regles de securite (cookies secure, limites de requetes) correctement meme lorsque le trafic transite par le proxy.

### Points de controle recommandes

- Verifier que le certificat TLS presente par votre reverse proxy est valide et renouvele automatiquement (Let's Encrypt ou equivalent).
- Ne jamais exposer directement le port applicatif d'Obliance sur Internet sans passer par le reverse proxy TLS.
- Verifier dans les parametres de votre proxy que les en-tetes d'origine standard sont correctement transmis au serveur, car celui-ci s'appuie dessus pour ses decisions de securite.

## Secret de session

Le serveur refuse explicitement de demarrer en production si le secret utilise pour signer les sessions est absent, egal a une valeur par defaut, ou trop court. Ce controle empeche de faire tourner une installation de production avec un secret de session trivialement devinable.

**A verifier au moment de l'installation :**

1. Definir une valeur dediee au secret de session dans votre configuration d'installation, **aleatoire et suffisamment longue**, generee specifiquement pour votre installation.
2. Ne jamais reutiliser un secret d'exemple trouve dans une documentation ou un depot public.
3. Conserver ce secret en lieu sur (gestionnaire de secrets, coffre-fort) : sa rotation invalide toutes les sessions actives et deconnecte tous les utilisateurs.

Les sessions elles-memes sont stockees cote serveur en base PostgreSQL (pas dans le cookie), avec une duree de vie de **7 jours**. Le cookie de session est en outre marque `httpOnly` (inaccessible en JavaScript cote navigateur) et `sameSite=lax` (protection de base contre le CSRF).

## En-tetes de securite HTTP

Obliance applique automatiquement, sans configuration necessaire, un ensemble d'en-tetes de securite HTTP a toutes les reponses du serveur :

| Protection | Comportement |
|---|---|
| Content-Security-Policy | Restreint le chargement des scripts, styles, images et connexions reseau a l'origine de l'application elle-meme (plus les blobs/data locaux pour les images), limitant fortement l'impact d'une eventuelle injection de script. |
| HSTS (Strict-Transport-Security) | Force le navigateur a toujours utiliser HTTPS pour communiquer avec le serveur, pendant 1 an, y compris pour les sous-domaines. |
| Referrer-Policy | Reglee sur `strict-origin-when-cross-origin`, limitant les informations de provenance transmises aux sites tiers. |
| Politiques de contenu tierces (Adobe/Flash) | Explicitement desactivees. |

Un point d'attention specifique : la protection anti-clickjacking standard ("X-Frame-Options") est **volontairement desactivee**. Ce choix est deliberement fait pour permettre a Obliance d'etre embarque en iframe par l'outil compagnon ObliTools. Si votre organisation a des exigences de securite qui interdisent l'embarquement en iframe, ce point doit etre pris en compte dans votre analyse de risque, par exemple en filtrant l'acces reseau a ObliTools plutot qu'en comptant sur ce mecanisme.

## Protection contre les abus (rate limiting)

Obliance integre plusieurs limiteurs de requetes qui s'appliquent automatiquement, sans configuration necessaire :

| Limiteur | Portee | Seuil |
|---|---|---|
| Limiteur global | Requetes non-authentifiees (les utilisateurs avec une session valide et les agents avec une cle API sont exclus de cette limite globale) | 500 requetes / 5 minutes |
| Limiteur de connexion | Tentatives de connexion, cle par IP + nom d'utilisateur | 20 tentatives **echouees** / 5 minutes (les connexions reussies ne sont pas comptees) |
| Limiteur MFA | Verification et renvoi de code 2FA, cle par IP | 50 tentatives / 15 minutes (les succes ne sont pas comptes) |

Ces limiteurs visent a ralentir les attaques par force brute sur les identifiants et les codes 2FA, sans penaliser un utilisateur legitime qui se connecte normalement. Aucune configuration n'est necessaire cote administrateur : ces protections sont actives par defaut sur toute installation.

### A retenir pour l'exploitation

- Si des utilisateurs legitimes rencontrent des blocages repetes (par exemple depuis une IP partagee type NAT d'entreprise avec beaucoup d'utilisateurs), cela peut indiquer un volume de trafic eleve derriere une meme adresse IP publique plutot qu'une attaque.
- Documentez l'adresse IP publique de sortie de votre organisation aupres de votre equipe support Obliance si vous rencontrez des faux positifs recurrents sur le limiteur global.
- Les echecs de connexion et de verification 2FA constituent un bon signal a surveiller dans vos journaux si vous soupconnez une tentative d'intrusion.