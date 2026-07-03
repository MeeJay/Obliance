Deux sections de la page ParamÃ¨tres pilotent les valeurs par dÃ©faut appliquÃ©es Ã  l'ensemble de la flotte d'appareils : les intervalles de fonctionnement de l'agent, et les seuils d'alerte sur les mÃ©triques systÃ¨me.

## Le principe de cascade

Obliance rÃ©sout la plupart de ses rÃ©glages de supervision selon une hiÃ©rarchie Ã  quatre niveaux, du plus gÃ©nÃ©ral au plus spÃ©cifique :

1. **Valeur systÃ¨me par dÃ©faut** â€” intÃ©grÃ©e Ã  l'application, sert de filet de sÃ©curitÃ© ultime.
2. **Global** â€” ce que vous Ã©ditez dans la page ParamÃ¨tres. S'applique Ã  tous les groupes et appareils qui n'ont pas de rÃ©glage plus spÃ©cifique.
3. **Groupe(s) ancÃªtres** â€” un rÃ©glage posÃ© sur un groupe s'applique Ã  tous ses sous-groupes et appareils, sauf surcharge plus bas.
4. **Appareil** â€” le niveau le plus spÃ©cifique, prioritaire sur tous les autres.

Ã€ chaque niveau, un champ laissÃ© vide hÃ©rite automatiquement de la valeur du niveau juste au-dessus (affichÃ©e grisÃ©e en placeholder). Modifier un rÃ©glage dans la page ParamÃ¨tres revient donc Ã  changer le niveau 2 (Global) de cette pyramide â€” cela ne touche pas les groupes ou appareils qui ont dÃ©jÃ  une valeur spÃ©cifique dÃ©finie chez eux.

## ParamÃ¨tres de moniteur par dÃ©faut

Cette section Ã©dite huit rÃ©glages qui contrÃ´lent le comportement de l'agent installÃ© sur les postes. Les libellÃ©s affichÃ©s dans l'interface sont en anglais, y compris sur une installation en franÃ§ais â€” ils ne sont actuellement pas traduits.

| RÃ©glage (libellÃ© UI) | Plage | Valeur par dÃ©faut | Niveau Ã©ditable | Description |
|---|---|---|---|---|
| Push Interval | 10 â€“ 3600 s | 60 s | Global / Groupe / Appareil | FrÃ©quence Ã  laquelle l'agent envoie ses mÃ©triques (CPU, RAM, disque, etc.) au serveur. |
| Scan Interval | 0 â€“ 86400 s | 3600 s | Global / Groupe / Appareil | FrÃ©quence du scan d'inventaire complet (matÃ©riel, logiciels, BitLocker...). 0 = dÃ©sactivÃ©. |
| Fast Poll Interval | 3 â€“ 30 s | 5 s | Global / Groupe / Appareil | Intervalle de sondage accÃ©lÃ©rÃ© utilisÃ© quand des commandes sont en attente d'exÃ©cution sur l'appareil. |
| Max Missed Pushes | 1 â€“ 20 | 3 | Global / Groupe / Appareil | Nombre de pushs consÃ©cutifs manquÃ©s avant de considÃ©rer l'appareil hors ligne. |
| Notification Cooldown | 0 â€“ 86400 s | 300 s | Global / Groupe / Appareil | DÃ©lai minimum entre deux alertes identiques, pour Ã©viter le spam de notifications. |
| Inventory Retention | 7 â€“ 365 jours | 90 jours | Global uniquement | DurÃ©e de conservation de l'historique d'inventaire. |
| Auto-Approve Devices | Oui / Non | Non | Global uniquement | Approuve automatiquement les nouveaux agents qui s'enregistrent, sans validation manuelle admin. |
| 2FA Â« Trust this IP Â» duration | 0 â€“ 8760 h | 24 h | Global uniquement | DurÃ©e pendant laquelle une adresse IP de confiance n'a pas besoin de redemander un code 2FA. 0 = toujours redemander. |

Les trois rÃ©glages marquÃ©s **Global uniquement** (Inventory Retention, Auto-Approve Devices, et la durÃ©e de confiance 2FA) n'apparaissent pas du tout dans les panneaux de rÃ©glages au niveau Groupe ou Appareil â€” ils ne peuvent Ãªtre ajustÃ©s que depuis cette page.

### PortÃ©e

Ces huit rÃ©glages ne sont pas isolÃ©s par tenant : le niveau **Global** Ã©ditÃ© ici est stockÃ© de faÃ§on commune Ã  toute l'installation et s'applique par dÃ©faut Ã  tous les tenants. Contrairement aux seuils mÃ©triques dÃ©crits plus bas, il n'existe pas de niveau de surcharge intermÃ©diaire par tenant pour ces rÃ©glages â€” seuls les niveaux Groupe et Appareil permettent de s'en Ã©carter localement.

**Attention particuliÃ¨re** : Auto-Approve Devices dÃ©sactive la validation manuelle des nouveaux agents. Ã€ n'activer que si vous maÃ®trisez bien vos clÃ©s API et leur groupe par dÃ©faut, sous peine de voir des appareils non dÃ©sirÃ©s rejoindre automatiquement la flotte.

## Seuils mÃ©triques globaux

Cette section dÃ©finit les seuils d'alerte (en pourcentage) pour trois mÃ©triques : **Disque**, **CPU** et **RAM**, avec pour chacune un seuil d'avertissement (warn) et un seuil critique (critical).

Ces seuils suivent la mÃªme logique de cascade que les paramÃ¨tres de moniteur, avec un niveau intermÃ©diaire supplÃ©mentaire :

1. Valeur systÃ¨me par dÃ©faut (intÃ©grÃ©e).
2. **Seuils globaux** (cette section) â€” s'appliquent par dÃ©faut Ã  **tous les tenants** de l'installation.
3. Surcharge par tenant, rÃ©glable dans **Politiques â†’ Seuils**.
4. Surcharge par groupe ou par appareil, la plus spÃ©cifique.

Un champ laissÃ© vide dans cette section hÃ©rite du seuil systÃ¨me par dÃ©faut (affichÃ© grisÃ©). Comme pour les paramÃ¨tres de moniteur, modifier un seuil ici ne touche pas les tenants, groupes ou appareils qui ont dÃ©jÃ  dÃ©fini leur propre surcharge.

Ã€ retenir : si vous gÃ©rez plusieurs tenants et souhaitez des seuils diffÃ©renciÃ©s par client, rÃ©glez-les plutÃ´t dans **Politiques â†’ Seuils** au niveau de chaque tenant â€” les seuils globaux ne doivent servir que de filet de sÃ©curitÃ© commun Ã  toute l'installation.

## Sur la validation des modifications

Comme les autres rÃ©glages communs Ã  toute l'installation prÃ©sents sur la page ParamÃ¨tres, l'enregistrement des paramÃ¨tres de moniteur par dÃ©faut et des seuils mÃ©triques globaux peut Ãªtre soumis Ã  une politique de restriction d'actions selon la configuration de votre installation (blocage, exigence d'un code de validation Ã  usage unique, ou passage par une demande d'approbation). Voir la page Â« Serveurs SMTP, sÃ©curitÃ© 2FA et connexion SSO Obligate Â» de ce chapitre pour le dÃ©tail de ce mÃ©canisme.