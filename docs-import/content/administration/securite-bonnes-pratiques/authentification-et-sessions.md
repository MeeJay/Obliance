# Authentification et gestion des sessions

Cette page dÃ©crit comment Obliance protÃ¨ge la connexion des utilisateurs, gÃ¨re les sessions actives, et s'intÃ¨gre en option avec la passerelle SSO Obligate.

## Connexion et limitation des tentatives

Chaque tentative de connexion Ã©chouÃ©e est comptabilisÃ©e par IP et par nom d'utilisateur combinÃ©s. Au-delÃ  de 20 Ã©checs sur une fenÃªtre glissante de 5 minutes, les tentatives suivantes sont bloquÃ©es temporairement â€” les connexions rÃ©ussies ne sont jamais comptÃ©es dans cette limite. Il s'agit d'un mÃ©canisme de ralentissement (throttling), pas d'un verrouillage dÃ©finitif du compte.

Une seconde limite gÃ©nÃ©rale (500 requÃªtes / 5 minutes par IP) protÃ¨ge les points d'entrÃ©e publics ou non authentifiÃ©s de l'API. Les sessions du tableau de bord dÃ©jÃ  authentifiÃ©es et les agents qui s'authentifient par clÃ© API ne sont pas soumis Ã  cette limite gÃ©nÃ©rale.

## Mots de passe

- Les mots de passe sont hachÃ©s avec l'algorithme bcrypt (12 tours de salage) avant stockage â€” ils ne sont jamais conservÃ©s en clair dans la base de donnÃ©es.
- La validation cÃ´tÃ© serveur impose uniquement une longueur minimale de 6 caractÃ¨res (128 maximum), aussi bien Ã  la crÃ©ation d'un compte qu'au changement ou Ã  la rÃ©initialisation d'un mot de passe. Obliance n'impose pas de rÃ¨gle de complexitÃ© (majuscule, chiffre, caractÃ¨re spÃ©cial...) : la politique de mots de passe reste Ã  la charge de l'organisation. Il est recommandÃ© de communiquer une consigne de longueur/complexitÃ© aux utilisateurs, car l'application ne la fera pas respecter automatiquement.
- Un flux de rÃ©initialisation en libre-service (Â« mot de passe oubliÃ© Â») est proposÃ© aux utilisateurs qui ont perdu leur mot de passe. Par conception, la requÃªte retourne toujours une rÃ©ponse gÃ©nÃ©rique de succÃ¨s, que l'adresse e-mail existe ou non dans l'annuaire â€” cela Ã©vite qu'un tiers puisse dÃ©duire quels comptes existent (Ã©numÃ©ration d'utilisateurs). Le lien de rÃ©initialisation reÃ§u par e-mail contient un jeton Ã  usage unique, vÃ©rifiÃ© indÃ©pendamment avant d'accepter le nouveau mot de passe.

## Sessions utilisateur

- Les sessions ne sont pas stockÃ©es dans le cookie envoyÃ© au navigateur : seul un identifiant de session y est placÃ©, l'Ã©tat de la session lui-mÃªme vit cÃ´tÃ© serveur, dans la base PostgreSQL (table dÃ©diÃ©e).
- Le cookie de session porte les attributs `httpOnly` (inaccessible en JavaScript cÃ´tÃ© navigateur) et `SameSite=Lax`, avec une durÃ©e de vie de 7 jours.
- L'attribut `secure` (cookie envoyÃ© uniquement sur HTTPS) est automatiquement forcÃ© Ã  vrai dÃ¨s que l'installation tourne en mode production (`NODE_ENV=production`), quelle que soit la configuration rÃ©seau â€” un cookie de session n'est donc jamais transmis en clair en production.
- Le secret de signature des sessions (variable d'environnement `SESSION_SECRET`) est une valeur obligatoire Ã  changer. En production, le serveur refuse de dÃ©marrer si ce secret est absent, laissÃ© Ã  sa valeur d'exemple fournie dans `docker-compose.yml`, ou trop court (moins de 32 caractÃ¨res). Il ne s'agit pas d'une simple recommandation : c'est une vÃ©rification bloquante au dÃ©marrage. GÃ©nÃ©rez une chaÃ®ne alÃ©atoire d'au moins 32 caractÃ¨res et renseignez-la dans la configuration de votre dÃ©ploiement avant toute mise en production.

## IntÃ©gration SSO via Obligate Gateway

Obliance peut dÃ©lÃ©guer l'authentification Ã  la passerelle d'identitÃ© Obligate plutÃ´t que de gÃ©rer les mots de passe localement.

1. Dans **ParamÃ¨tres**, ouvrir la section **Obligate SSO Gateway**.
2. Renseigner l'URL de la passerelle Obligate ainsi qu'une clÃ© API valide.
3. Activer l'intÃ©gration SSO.

Une fois le SSO activÃ©, l'authentification locale par nom d'utilisateur / mot de passe est dÃ©sactivÃ©e pour les utilisateurs concernÃ©s. Un mÃ©canisme de repli est intÃ©grÃ© : si la passerelle Obligate devient injoignable, l'authentification locale est automatiquement restaurÃ©e, ce qui Ã©vite qu'une panne du SSO ne bloque tous les accÃ¨s Ã  l'installation.