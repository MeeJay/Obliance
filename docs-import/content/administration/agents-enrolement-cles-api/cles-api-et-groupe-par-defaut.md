Les cles API sont le mecanisme qui permet a un nouvel agent de s'identifier aupres du serveur Obliance et, optionnellement, d'etre range automatiquement dans un groupe a son approbation.

## Ou gerer les cles API

Les cles API se gerent depuis la page **Agent config** (accessible depuis la barre laterale, section administration), dans l'onglet **Cles API**. Cette page comporte 3 onglets au total :

- **Cles API** — creation, edition et suppression des cles.
- **Custom sections**
- **Discovery**

## Creer une cle API

Depuis l'onglet **Cles API**, un formulaire de creation permet de definir :

- un **nom** pour la cle (libre, sert a l'identifier dans les listes et lors du choix de cle dans la fenetre **Ajouter un agent**) ;
- un **groupe par defaut** (optionnel), choisi dans un menu deroulant listant les groupes existants.

Une fois creee, la cle apparait dans la liste avec son nom, sa valeur, le nombre d'appareils actuellement enroles avec elle, sa date de creation et sa derniere utilisation.

## Role du groupe par defaut

Lorsque le groupe par defaut est renseigne sur une cle API, tout agent qui s'enrole avec cette cle et qui **n'a pas deja de groupe assigne** se voit automatiquement place dans ce groupe **au moment de son approbation** (pas au moment de l'enregistrement initial). Cette affectation automatique ne se produit qu'une seule fois, a l'approbation.

Si la cle API utilisee pour enroler l'agent n'a **pas** de groupe par defaut configure, l'agent reste **sans groupe** ("orphelin") apres son approbation, jusqu'a ce qu'un administrateur l'affecte manuellement a un groupe depuis la page **Appareils**.

> Consequence pratique : si vous deployez des postes destines a un site ou un service particulier, creez (ou reutilisez) une cle API dediee avec le bon groupe par defaut avant de lancer le deploiement en masse. Cela evite de devoir trier et deplacer manuellement chaque appareil apres coup.

## Editer ou supprimer une cle

- **Editer** : le formulaire d'edition permet notamment de changer le groupe par defaut d'une cle existante ; ce changement n'affecte que les futurs agents approuves avec cette cle, pas les appareils deja assignes.
- **Supprimer** : une confirmation est demandee avant suppression. Les appareils deja enroles avec cette cle restent fonctionnels ; seule la possibilite d'enroler de nouveaux agents avec cette cle disparait.

## Bonnes pratiques

- Creez une cle API par contexte de deploiement logique (par client, par site, par lot de machines) plutot qu'une cle unique partagee par tout le parc : cela facilite le tri automatique via le groupe par defaut et permet de savoir d'un coup d'oeil, via le compteur d'appareils, combien de machines ont ete enrolees avec chaque cle.
- Verifiez le champ "derniere utilisation" d'une cle avant de la supprimer, pour vous assurer qu'elle n'est pas encore utilisee dans un script de deploiement actif.
- Traitez vos cles API comme des secrets : partagez-les uniquement via un canal securise et evitez de les laisser en clair dans des scripts ou tickets partages largement.