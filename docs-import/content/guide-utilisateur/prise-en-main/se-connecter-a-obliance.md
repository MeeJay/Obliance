# Se connecter à Obliance

Cette page explique comment accéder à Obliance pour la première fois, que votre entreprise utilise ou non un système d'authentification centralisée, et comment fonctionne la double authentification si elle est activée sur votre compte.

## Ce qui se passe à l'ouverture de la page de connexion

Quand vous ouvrez l'adresse d'Obliance dans votre navigateur, l'application vérifie automatiquement si vous avez déjà une session active. Si c'est le cas, vous êtes envoyé directement sur le tableau de bord sans rien avoir à saisir.

Si vous n'êtes pas encore connecté, Obliance vérifie ensuite si votre organisation utilise un système d'authentification centralisée (nommé **Obligate**). Trois cas de figure sont possibles :

| Situation | Ce qui se passe |
|---|---|
| Obligate est configuré et joignable | Vous êtes redirigé automatiquement vers la page de connexion centralisée. Aucun formulaire ne s'affiche sur Obliance. |
| Obligate n'est pas configuré | Le formulaire classique identifiant / mot de passe s'affiche directement. |
| Obligate est configuré mais injoignable | Un bandeau d'avertissement s'affiche pour vous prévenir que l'authentification centralisée est momentanément indisponible. Le formulaire classique s'affiche en dessous, en solution de secours. |

> **Astuce** : si la redirection automatique vers Obligate se déclenche mais que vous devez absolument utiliser le formulaire classique (par exemple pour un compte administrateur local), ajoutez `?local=1` à la fin de l'adresse de la page de connexion pour forcer son affichage.

## Se connecter avec un identifiant et un mot de passe

1. Saisissez votre identifiant.
2. Saisissez votre mot de passe.
3. Cliquez sur **Se connecter**.

## La double authentification (2FA)

Si la double authentification est activée sur votre compte, une seconde étape s'affiche automatiquement après la saisie de votre identifiant et de votre mot de passe. Selon ce qui a été configuré sur votre compte, on vous demandera :

- un code à 6 chiffres généré par une application d'authentification (TOTP), et/ou
- un code envoyé par email.

Si les deux méthodes sont actives sur votre compte, des onglets vous permettent de choisir laquelle utiliser au moment de la connexion.

## Après la connexion

Une fois connecté, deux cas se présentent :

- s'il s'agit de votre toute première connexion (ou si votre profil n'a pas encore été complété), vous êtes automatiquement dirigé vers l'assistant de configuration initiale avant de pouvoir accéder au reste de l'application ;
- sinon, vous arrivez directement sur le tableau de bord.

> **Bonne pratique** : choisissez un mot de passe robuste et propre à Obliance, et activez la double authentification dès que possible pour renforcer la sécurité de votre compte.
