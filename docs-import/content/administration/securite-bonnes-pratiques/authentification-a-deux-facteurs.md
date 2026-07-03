# Authentification Ã  deux facteurs (2FA)

Obliance propose une authentification Ã  deux facteurs optionnelle, activable et pilotable finement par les administrateurs.

## MÃ©thodes disponibles

Chaque utilisateur peut configurer une ou plusieurs des mÃ©thodes suivantes :

| MÃ©thode | Fonctionnement |
|---|---|
| **Authenticator App (TOTP)** | EnrÃ´lement par QR code dans une application d'authentification (Google Authenticator, Authy...). Code Ã  6 chiffres, pÃ©riode de 30 secondes, avec une tolÃ©rance de dÃ©rive d'horloge de Â±60 secondes. |
| **Email OTP** | Code Ã  usage unique Ã  6 chiffres envoyÃ© par e-mail via le serveur SMTP configurÃ© par l'administrateur pour l'installation. Le code n'est jamais stockÃ© en clair cÃ´tÃ© serveur : il est hachÃ©, et sa vÃ©rification utilise une comparaison Ã  temps constant pour limiter les attaques par mesure de timing. Il expire au bout de 10 minutes. |

Les tentatives de vÃ©rification d'un code 2FA sont elles-mÃªmes limitÃ©es : 50 tentatives maximum par 15 minutes et par IP.

## Activer le 2FA pour l'ensemble de l'installation

Dans **ParamÃ¨tres > SÃ©curitÃ©**, deux rÃ©glages contrÃ´lent le 2FA au niveau du tenant :

- **Autoriser les utilisateurs Ã  configurer le 2FA** (*Allow users to configure 2FA*) â€” rend l'option disponible dans le profil des utilisateurs, sans les y obliger.
- **Forcer le 2FA pour tous les utilisateurs** (*Force 2FA for all users*) â€” impose une mÃ©thode 2FA Ã  chaque utilisateur du tenant.

Lorsque le 2FA est forcÃ©, un utilisateur qui n'a pas encore configurÃ© de mÃ©thode voit, Ã  sa prochaine connexion, un avertissement l'invitant Ã  en configurer une.

## Confiance par adresse IP

Pour limiter la friction sans dÃ©sactiver la sÃ©curitÃ©, Obliance peut retenir qu'une adresse IP a dÃ©jÃ  passÃ© une vÃ©rification 2FA avec succÃ¨s pour un utilisateur donnÃ©, et ne plus la redemander pendant une durÃ©e configurable par tenant (24 heures par dÃ©faut). Un administrateur peut :

- RÃ©duire ou augmenter cette durÃ©e de confiance.
- La mettre Ã  **0** pour dÃ©sactiver complÃ¨tement la confiance par IP et forcer une vÃ©rification 2FA Ã  chaque connexion, sans exception.

DÃ©sactiver la mÃ©thode TOTP d'un utilisateur rÃ©voque automatiquement toutes ses IP de confiance enregistrÃ©es â€” il devra repasser une vÃ©rification complÃ¨te Ã  sa prochaine connexion.

## ProcÃ©dure de secours en cas de verrouillage administrateur

Si le 2FA forcÃ© bloque un administrateur qui n'a pas de mÃ©thode configurÃ©e (perte de tÃ©lÃ©phone, SMTP en panne...), une variable d'environnement de secours permet de lever temporairement l'obligation de 2FA au niveau de l'installation. Ce mÃ©canisme est documentÃ© directement dans le texte d'aide de la page **ParamÃ¨tres > SÃ©curitÃ©** et doit Ãªtre rÃ©servÃ© Ã  un usage exceptionnel de rÃ©cupÃ©ration : une fois l'accÃ¨s rÃ©tabli, il convient de retirer cette dÃ©rogation et de reconfigurer une mÃ©thode 2FA normale pour le ou les comptes concernÃ©s.