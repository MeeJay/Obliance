Deux sections avancÃ©es de la page ParamÃ¨tres, rÃ©servÃ©es aux administrateurs, permettent d'harmoniser le comportement d'alerte et les rÃ©ponses type utilisÃ©es lors du support.

## Section Â« Seuils mÃ©triques globaux Â»

Ce bloc dÃ©finit les **seuils d'alerte par dÃ©faut** (CPU, mÃ©moire, disque, etc.) qui s'appliquent Ã  l'ensemble des tenants de l'installation.

- Chaque tenant peut ensuite surcharger tout ou partie de ces seuils via sa propre page **Politiques â†’ Seuils** â€” la valeur dÃ©finie ici au niveau global agit comme filet de sÃ©curitÃ© pour les tenants qui n'ont rien personnalisÃ©.
- Dans le formulaire, un champ laissÃ© **vide** (affichÃ© en grisÃ© avec une valeur d'exemple en placeholder) signifie que la valeur par dÃ©faut technique du systÃ¨me est utilisÃ©e â€” il n'est donc pas nÃ©cessaire de remplir tous les champs si les valeurs systÃ¨me conviennent.
- Boutons **Enregistrer** / **Annuler** en bas de section.

Utiliser cette section pour fixer une politique d'alerte cohÃ©rente sur l'ensemble du parc (par exemple un seuil d'alerte disque Ã  90 % partout), tout en laissant chaque tenant affiner selon ses besoins propres depuis sa page Politiques.

## Section Â« Quick Reply Templates Â»

Cette section gÃ¨re des **modÃ¨les de rÃ©ponse rapide multilingues**, destinÃ©s Ã  accÃ©lÃ©rer la rÃ©daction de messages type (probablement utilisÃ©s lors d'Ã©changes avec les utilisateurs via le panneau de discussion/assistance intÃ©grÃ© Ã  Obliance).

- Chaque modÃ¨le propose un champ de texte pour chacune des **18 langues** supportÃ©es par Obliance.
- Le texte en **anglais est obligatoire** ; les autres langues sont optionnelles (une langue non renseignÃ©e peut retomber sur la version anglaise Ã  l'usage).
- Utile pour standardiser les rÃ©ponses envoyÃ©es aux utilisateurs finaux (ex. confirmation de prise en main Ã  distance, consignes de redÃ©marrage) sans avoir Ã  ressaisir un texte traduit Ã  chaque fois.

### Bonnes pratiques

- RÃ©diger d'abord la version anglaise, complÃ¨te et sans ambiguÃ¯tÃ©, puis complÃ©ter progressivement les langues rÃ©ellement utilisÃ©es par les Ã©quipes/utilisateurs de l'installation plutÃ´t que de tenter de traduire les 18 langues d'un coup.
- Revoir les seuils mÃ©triques globaux aprÃ¨s tout changement significatif de parc (ex. ajout de machines avec des profils disque/mÃ©moire trÃ¨s diffÃ©rents), afin d'Ã©viter des alertes trop bruyantes ou au contraire des seuils trop larges qui masqueraient un vrai problÃ¨me.