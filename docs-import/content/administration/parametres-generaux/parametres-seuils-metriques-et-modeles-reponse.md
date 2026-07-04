Deux sections avancées de la page Paramètres, réservées aux administrateurs, permettent d'harmoniser le comportement d'alerte et les réponses type utilisées lors du support.

## Section « Seuils métriques globaux »

Ce bloc définit les **seuils d'alerte par défaut** (CPU, mémoire, disque, etc.) qui s'appliquent à l'ensemble des tenants de l'installation.

- Chaque tenant peut ensuite surcharger tout ou partie de ces seuils via sa propre page **Politiques → Seuils** — la valeur définie ici au niveau global agit comme filet de sécurité pour les tenants qui n'ont rien personnalisé.
- Dans le formulaire, un champ laissé **vide** (affiché en grisé avec une valeur d'exemple en placeholder) signifie que la valeur par défaut technique du système est utilisée — il n'est donc pas nécessaire de remplir tous les champs si les valeurs système conviennent.
- Boutons **Enregistrer** / **Annuler** en bas de section.

Utiliser cette section pour fixer une politique d'alerte cohérente sur l'ensemble du parc (par exemple un seuil d'alerte disque à 90 % partout), tout en laissant chaque tenant affiner selon ses besoins propres depuis sa page Politiques.

## Section « Quick Reply Templates »

Cette section gère des **modèles de réponse rapide multilingues**, destinés à accélérer la rédaction de messages type (probablement utilisés lors d'échanges avec les utilisateurs via le panneau de discussion/assistance intégré à Obliance).

- Chaque modèle propose un champ de texte pour chacune des **18 langues** supportées par Obliance.
- Le texte en **anglais est obligatoire** ; les autres langues sont optionnelles (une langue non renseignée peut retomber sur la version anglaise à l'usage).
- Utile pour standardiser les réponses envoyées aux utilisateurs finaux (ex. confirmation de prise en main à distance, consignes de redémarrage) sans avoir à ressaisir un texte traduit à chaque fois.

### Bonnes pratiques

- Rédiger d'abord la version anglaise, complète et sans ambiguïté, puis compléter progressivement les langues réellement utilisées par les équipes/utilisateurs de l'installation plutôt que de tenter de traduire les 18 langues d'un coup.
- Revoir les seuils métriques globaux après tout changement significatif de parc (ex. ajout de machines avec des profils disque/mémoire très différents), afin d'éviter des alertes trop bruyantes ou au contraire des seuils trop larges qui masqueraient un vrai problème.