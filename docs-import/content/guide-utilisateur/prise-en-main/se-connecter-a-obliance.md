# Se connecter Ã  Obliance

Cette page explique comment accÃ©der Ã  Obliance pour la premiÃ¨re fois, que votre entreprise utilise ou non un systÃ¨me d'authentification centralisÃ©e, et comment fonctionne la double authentification si elle est activÃ©e sur votre compte.

## Ce qui se passe Ã  l'ouverture de la page de connexion

Quand vous ouvrez l'adresse d'Obliance dans votre navigateur, l'application vÃ©rifie automatiquement si vous avez dÃ©jÃ  une session active. Si c'est le cas, vous Ãªtes envoyÃ© directement sur le tableau de bord sans rien avoir Ã  saisir.

Si vous n'Ãªtes pas encore connectÃ©, Obliance vÃ©rifie ensuite si votre organisation utilise un systÃ¨me d'authentification centralisÃ©e (nommÃ© **Obligate**). Trois cas de figure sont possibles :

| Situation | Ce qui se passe |
|---|---|
| Obligate est configurÃ© et joignable | Vous Ãªtes redirigÃ© automatiquement vers la page de connexion centralisÃ©e. Aucun formulaire ne s'affiche sur Obliance. |
| Obligate n'est pas configurÃ© | Le formulaire classique identifiant / mot de passe s'affiche directement. |
| Obligate est configurÃ© mais injoignable | Un bandeau d'avertissement s'affiche pour vous prÃ©venir que l'authentification centralisÃ©e est momentanÃ©ment indisponible. Le formulaire classique s'affiche en dessous, en solution de secours. |

> **Astuce** : si la redirection automatique vers Obligate se dÃ©clenche mais que vous devez absolument utiliser le formulaire classique (par exemple pour un compte administrateur local), ajoutez `?local=1` Ã  la fin de l'adresse de la page de connexion pour forcer son affichage.

## Se connecter avec un identifiant et un mot de passe

1. Saisissez votre identifiant.
2. Saisissez votre mot de passe.
3. Cliquez sur **Se connecter**.

## La double authentification (2FA)

Si la double authentification est activÃ©e sur votre compte, une seconde Ã©tape s'affiche automatiquement aprÃ¨s la saisie de votre identifiant et de votre mot de passe. Selon ce qui a Ã©tÃ© configurÃ© sur votre compte, on vous demandera :

- un code Ã  6 chiffres gÃ©nÃ©rÃ© par une application d'authentification (TOTP), et/ou
- un code envoyÃ© par email.

Si les deux mÃ©thodes sont actives sur votre compte, des onglets vous permettent de choisir laquelle utiliser au moment de la connexion.

## AprÃ¨s la connexion

Une fois connectÃ©, deux cas se prÃ©sentent :

- s'il s'agit de votre toute premiÃ¨re connexion (ou si votre profil n'a pas encore Ã©tÃ© complÃ©tÃ©), vous Ãªtes automatiquement dirigÃ© vers l'assistant de configuration initiale avant de pouvoir accÃ©der au reste de l'application ;
- sinon, vous arrivez directement sur le tableau de bord.

> **Bonne pratique** : choisissez un mot de passe robuste et propre Ã  Obliance, et activez la double authentification dÃ¨s que possible pour renforcer la sÃ©curitÃ© de votre compte.
