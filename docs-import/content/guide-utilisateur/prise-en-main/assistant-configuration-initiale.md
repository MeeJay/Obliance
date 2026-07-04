# L'assistant de configuration initiale

Lors de votre toute première connexion à Obliance, un assistant de configuration s'affiche avant de vous laisser accéder au reste de l'application : il vous permet de personnaliser votre compte en quelques étapes guidées.

## Quand l'assistant apparaît

L'assistant se déclenche automatiquement juste après une connexion réussie, tant que votre profil n'a pas encore été complété. Il bloque l'accès aux autres pages tant qu'il n'a pas été terminé (ou passé, pour les étapes qui le permettent).

Si votre compte est géré via l'authentification centralisée Obligate, la plupart des étapes sont automatiquement sautées : seules les étapes **Langue** et **Apparence** vous sont proposées, les informations de profil, de sécurité et de mot de passe étant déjà gérées par Obligate.

## Les étapes pour un compte local

Pour un compte local (identifiant / mot de passe géré directement dans Obliance), l'assistant se déroule dans cet ordre :

| Ordre | Étape | Contenu |
|---|---|---|
| 1 | Langue | Choix de la langue de l'interface |
| 2 | Profil | Nom d'affichage et adresse email |
| 3 | Alertes | Préférences de notifications |
| 4 | Apparence | Choix du thème visuel |
| 5 | Mot de passe | Définition ou changement du mot de passe |
| 6 | Sécurité | Configuration de la double authentification |

Un indicateur d'étapes en haut de l'assistant vous montre votre progression à tout moment.

### 1. Langue

Choisissez votre langue parmi les 18 langues disponibles, chacune affichée avec son drapeau et son nom natif : anglais, français, espagnol, allemand, portugais (Brésil), chinois simplifié, japonais, coréen, russe, arabe, italien, néerlandais, polonais, turc, suédois, danois, tchèque, ukrainien. Le changement de langue s'applique immédiatement à toute l'interface.

### 2. Profil

Renseignez :

- votre **nom d'affichage** (facultatif) ;
- votre **adresse email** (obligatoire). Cette adresse sert notamment à réinitialiser votre mot de passe et à recevoir un code de double authentification par email si vous choisissez cette méthode.

### 3. Alertes

Activez ou désactivez l'affichage des notifications temporaires (petites fenêtres d'information qui apparaissent brièvement à l'écran) et choisissez leur position d'affichage : en bas à droite ou en haut au centre de l'écran. Un aperçu visuel vous montre le résultat en direct pendant que vous choisissez.

### 4. Apparence

Choisissez votre thème visuel parmi 4 propositions : **Obli Operator**, **Obli Daylight**, **Modern UI**, **Neon UI**. Le thème s'applique immédiatement à l'écran pendant que vous parcourez les options, pour que vous puissiez voir le résultat avant de valider.

### 5. Mot de passe

Définissez votre mot de passe (8 caractères minimum) et confirmez-le en le saisissant une seconde fois. Cette étape est obligatoire si votre compte n'a pas encore de mot de passe ; sinon, vous pouvez la passer si vous ne souhaitez pas le changer.

> **Bonne pratique** : privilégiez un mot de passe long et unique, que vous n'utilisez sur aucun autre service.

### 6. Sécurité

Cette étape vous propose d'activer la double authentification par application (TOTP) : un code QR s'affiche, à scanner avec votre application d'authentification, puis vous confirmez avec le code à 6 chiffres généré. Vous pouvez aussi choisir de passer cette étape pour la configurer plus tard. Si la double authentification est déjà active sur votre compte, cette étape affiche simplement une confirmation.

> **Bonne pratique** : activer la double authentification est fortement recommandé, en particulier si vous avez un rôle administrateur.

## Terminer l'assistant

Une fois toutes les étapes complétées (ou passées lorsque c'est autorisé), validez la dernière étape pour finaliser la configuration. Vous êtes alors redirigé vers le tableau de bord.
