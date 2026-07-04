# Conformité : consulter et corriger les résultats

Cette page explique comment lire les résultats de conformité de vos appareils et corriger ce qui ne va pas, depuis l'onglet **Résultats** de la page Conformité (**Politiques > Conformité > Résultats**).

## Filtrer les résultats

En haut de l'onglet Résultats, deux filtres permettent de cibler ce que vous regardez :

- **Par appareil** : afficher les résultats de tous les appareils ou d'un appareil précis.
- **Par référentiel** : afficher tous les référentiels ou se concentrer sur un seul (par exemple uniquement les résultats liés à la politique ISO 27001).

## Lire le score de conformité

Pour l'ensemble filtré, la page affiche :

- Un **score moyen** en pourcentage.
- Le nombre de règles **Conformes**.
- Le nombre de règles **Non conformes**.

Le score est mis en couleur pour une lecture rapide :

| Couleur | Score |
|---|---|
| Vert | 80 % ou plus |
| Jaune | Entre 50 % et 79 % |
| Rouge | En dessous de 50 % |

Chaque appareil affiche également son propre badge avec le détail du nombre de règles conformes, en attention et non conformes.

## Consulter le détail d'un appareil

En dépliant le détail d'un appareil, vous voyez la liste des règles évaluées, avec pour chaque règle en échec :

- Un bouton **Remediate** (icône clé) : lance la correction automatique de cette règle précise, si une correction automatique est disponible pour elle. Certaines règles (notamment sur les référentiels déclaratifs comme OPNsense) n'ont pas de correction automatique et doivent être traitées manuellement.
- Un bouton **Ignore** (icône œil barré) : permet de marquer une règle comme volontairement ignorée sur cet appareil (par exemple si elle ne s'applique pas à ce cas précis). La règle passe alors avec un badge **ignored**. Le bouton devient **Unignore** pour revenir en arrière.
- Un badge **remediated** apparaît sur une règle qui vient d'être corrigée automatiquement.

## Corriger plusieurs règles en une fois

Lorsqu'un appareil a plusieurs règles en échec disposant d'une correction automatique, un bouton **Fix All** (ou **Remediate all (n)**, n étant le nombre de règles concernées) permet de toutes les corriger en une seule action, sans avoir à cliquer règle par règle.

## Relancer un contrôle

Un bouton de relance (icône de rafraîchissement) permet de redéclencher immédiatement un contrôle de conformité sur un appareil ou une politique donnée, par exemple après une correction manuelle effectuée directement sur la machine, pour vérifier que le problème est bien résolu sans attendre le prochain contrôle automatique.

## Bon réflexe en cas d'appareil rouge

1. Ouvrir le détail de l'appareil concerné dans l'onglet Résultats.
2. Regarder les règles en échec listées.
3. Utiliser **Fix All** si plusieurs règles peuvent être corrigées automatiquement, ou **Remediate** règle par règle si vous voulez garder le contrôle sur ce qui est modifié.
4. Relancer le contrôle pour confirmer que le score est remonté.
5. Si une règle ne peut pas être corrigée automatiquement et ne s'applique pas à cet appareil, utiliser **Ignore** plutôt que de la laisser polluer le score indéfiniment.
