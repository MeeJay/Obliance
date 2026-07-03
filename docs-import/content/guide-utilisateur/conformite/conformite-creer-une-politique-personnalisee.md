# ConformitÃ© : crÃ©er une politique personnalisÃ©e

Au-delÃ  des 12 prÃ©rÃ©glages prÃªts Ã  l'emploi, vous pouvez crÃ©er vos propres politiques de conformitÃ© depuis l'onglet **Politiques** de la page ConformitÃ© (**Politiques > ConformitÃ© > Politiques**).

## CrÃ©er une politique

Depuis l'onglet Politiques, la crÃ©ation d'une nouvelle politique demande de renseigner :

- **Nom** de la politique.
- **RÃ©fÃ©rentiel** : CIS, NIST, ISO 27001, PCI DSS, HIPAA, SOC 2, ou **Custom** si la politique ne correspond Ã  aucun standard officiel (c'est le cas notamment des bases "Security Baseline" et "Haute Performance" fournies par Obliance).
- **Cible** : appliquer la politique Ã  **tous les appareils**, ou uniquement Ã  **un ou plusieurs groupes** sÃ©lectionnÃ©s.
- **Description** (facultative) pour documenter le but de la politique.
- La liste des **rÃ¨gles** qui composent la politique, ajoutÃ©es une par une via l'Ã©diteur de rÃ¨gles.

## Partir d'un prÃ©rÃ©glage plutÃ´t que de zÃ©ro

PlutÃ´t que de construire une politique rÃ¨gle par rÃ¨gle, le plus simple est de partir d'un prÃ©rÃ©glage existant proche de votre besoin (voir la page "ConformitÃ© : le catalogue des prÃ©rÃ©glages") et d'utiliser le bouton **Partir d'un template**. Toutes les rÃ¨gles du prÃ©rÃ©glage choisi sont alors reprises dans l'Ã©diteur, et vous pouvez :

- Retirer les rÃ¨gles qui ne concernent pas votre contexte.
- Ajouter des rÃ¨gles spÃ©cifiques Ã  votre organisation.
- Modifier les valeurs attendues d'une rÃ¨gle existante (par exemple durcir une longueur minimale de mot de passe).

Une fois les ajustements faits, vous enregistrez sous un nouveau nom : la politique d'origine (le prÃ©rÃ©glage) n'est pas modifiÃ©e, vous crÃ©ez bien une politique distincte.

## A quoi ressemble une rÃ¨gle

Chaque rÃ¨gle dÃ©finie dans une politique repose sur les mÃªmes informations, quel que soit le rÃ©fÃ©rentiel :

- Un nom et une catÃ©gorie (par exemple "Pare-feu", "Comptes", "RÃ©seau"...).
- Ce qui est contrÃ´lÃ© concrÃ¨tement sur la machine (une clÃ© de registre, un fichier, une commande, l'Ã©tat d'un service, une entrÃ©e de journal d'Ã©vÃ©nements, ou une politique systÃ¨me), et la valeur attendue.
- Une maniÃ¨re de comparer la valeur trouvÃ©e Ã  la valeur attendue (Ã©gal, diffÃ©rent, contient, ne contient pas, existe, n'existe pas, supÃ©rieur, infÃ©rieur, ou expression rÃ©guliÃ¨re).
- Un niveau de gravitÃ© si la rÃ¨gle Ã©choue : facultatif, faible, modÃ©rÃ©, Ã©levÃ© ou critique.
- Un script de correction automatique, s'il en existe un pour cette rÃ¨gle. Une rÃ¨gle sans script de correction reste utile pour dÃ©tecter un Ã©cart, mais devra Ãªtre corrigÃ©e manuellement si elle Ã©choue.

## GÃ©rer une politique existante appartenant Ã  un autre pÃ©rimÃ¨tre (vue multi-site)

Si votre organisation gÃ¨re plusieurs sites ou entitÃ©s (vue "master"), certaines politiques de conformitÃ© peuvent avoir Ã©tÃ© crÃ©Ã©es par un autre site et simplement partagÃ©es en lecture avec le vÃ´tre. Dans ce cas, la politique affiche un badge **Master** et les boutons Modifier/Supprimer sont dÃ©sactivÃ©s : vous pouvez consulter et appliquer les rÃ©sultats de cette politique, mais seule l'entitÃ© propriÃ©taire peut la modifier ou la supprimer.

## Bonnes pratiques

- Donner un nom de politique explicite incluant la cible (par exemple "ISO 27001 - Serveurs Production") plutÃ´t qu'un nom gÃ©nÃ©rique, surtout si plusieurs politiques proches coexistent.
- Cibler des groupes plutÃ´t que "tous les appareils" dÃ¨s que la politique ne s'applique pas Ã  l'ensemble du parc (une politique OPNsense n'a par exemple de sens que sur le groupe des appliances pare-feu).
- Tester une nouvelle politique sur un petit groupe pilote avant de l'Ã©tendre Ã  tout le parc, afin de vÃ©rifier que le score obtenu et les corrections automatiques proposÃ©es correspondent bien Ã  ce qui est attendu.
