# Conformité : créer une politique personnalisée

Au-delà des 12 préréglages prêts à l'emploi, vous pouvez créer vos propres politiques de conformité depuis l'onglet **Politiques** de la page Conformité (**Politiques > Conformité > Politiques**).

## Créer une politique

Depuis l'onglet Politiques, la création d'une nouvelle politique demande de renseigner :

- **Nom** de la politique.
- **Référentiel** : CIS, NIST, ISO 27001, PCI DSS, HIPAA, SOC 2, ou **Custom** si la politique ne correspond à aucun standard officiel (c'est le cas notamment des bases "Security Baseline" et "Haute Performance" fournies par Obliance).
- **Cible** : appliquer la politique à **tous les appareils**, ou uniquement à **un ou plusieurs groupes** sélectionnés.
- **Description** (facultative) pour documenter le but de la politique.
- La liste des **règles** qui composent la politique, ajoutées une par une via l'éditeur de règles.

## Partir d'un préréglage plutôt que de zéro

Plutôt que de construire une politique règle par règle, le plus simple est de partir d'un préréglage existant proche de votre besoin (voir la page "Conformité : le catalogue des préréglages") et d'utiliser le bouton **Partir d'un template**. Toutes les règles du préréglage choisi sont alors reprises dans l'éditeur, et vous pouvez :

- Retirer les règles qui ne concernent pas votre contexte.
- Ajouter des règles spécifiques à votre organisation.
- Modifier les valeurs attendues d'une règle existante (par exemple durcir une longueur minimale de mot de passe).

Une fois les ajustements faits, vous enregistrez sous un nouveau nom : la politique d'origine (le préréglage) n'est pas modifiée, vous créez bien une politique distincte.

## A quoi ressemble une règle

Chaque règle définie dans une politique repose sur les mêmes informations, quel que soit le référentiel :

- Un nom et une catégorie (par exemple "Pare-feu", "Comptes", "Réseau"...).
- Ce qui est contrôlé concrètement sur la machine (une clé de registre, un fichier, une commande, l'état d'un service, une entrée de journal d'événements, ou une politique système), et la valeur attendue.
- Une manière de comparer la valeur trouvée à la valeur attendue (égal, différent, contient, ne contient pas, existe, n'existe pas, supérieur, inférieur, ou expression régulière).
- Un niveau de gravité si la règle échoue : facultatif, faible, modéré, élevé ou critique.
- Un script de correction automatique, s'il en existe un pour cette règle. Une règle sans script de correction reste utile pour détecter un écart, mais devra être corrigée manuellement si elle échoue.

## Gérer une politique existante appartenant à un autre périmètre (vue multi-site)

Si votre organisation gère plusieurs sites ou entités (vue "master"), certaines politiques de conformité peuvent avoir été créées par un autre site et simplement partagées en lecture avec le vôtre. Dans ce cas, la politique affiche un badge **Master** et les boutons Modifier/Supprimer sont désactivés : vous pouvez consulter et appliquer les résultats de cette politique, mais seule l'entité propriétaire peut la modifier ou la supprimer.

## Bonnes pratiques

- Donner un nom de politique explicite incluant la cible (par exemple "ISO 27001 - Serveurs Production") plutôt qu'un nom générique, surtout si plusieurs politiques proches coexistent.
- Cibler des groupes plutôt que "tous les appareils" dès que la politique ne s'applique pas à l'ensemble du parc (une politique OPNsense n'a par exemple de sens que sur le groupe des appliances pare-feu).
- Tester une nouvelle politique sur un petit groupe pilote avant de l'étendre à tout le parc, afin de vérifier que le score obtenu et les corrections automatiques proposées correspondent bien à ce qui est attendu.
