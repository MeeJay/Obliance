# ConformitÃ© : consulter et corriger les rÃ©sultats

Cette page explique comment lire les rÃ©sultats de conformitÃ© de vos appareils et corriger ce qui ne va pas, depuis l'onglet **RÃ©sultats** de la page ConformitÃ© (**Politiques > ConformitÃ© > RÃ©sultats**).

## Filtrer les rÃ©sultats

En haut de l'onglet RÃ©sultats, deux filtres permettent de cibler ce que vous regardez :

- **Par appareil** : afficher les rÃ©sultats de tous les appareils ou d'un appareil prÃ©cis.
- **Par rÃ©fÃ©rentiel** : afficher tous les rÃ©fÃ©rentiels ou se concentrer sur un seul (par exemple uniquement les rÃ©sultats liÃ©s Ã  la politique ISO 27001).

## Lire le score de conformitÃ©

Pour l'ensemble filtrÃ©, la page affiche :

- Un **score moyen** en pourcentage.
- Le nombre de rÃ¨gles **Conformes**.
- Le nombre de rÃ¨gles **Non conformes**.

Le score est mis en couleur pour une lecture rapide :

| Couleur | Score |
|---|---|
| Vert | 80 % ou plus |
| Jaune | Entre 50 % et 79 % |
| Rouge | En dessous de 50 % |

Chaque appareil affiche Ã©galement son propre badge avec le dÃ©tail du nombre de rÃ¨gles conformes, en attention et non conformes.

## Consulter le dÃ©tail d'un appareil

En dÃ©pliant le dÃ©tail d'un appareil, vous voyez la liste des rÃ¨gles Ã©valuÃ©es, avec pour chaque rÃ¨gle en Ã©chec :

- Un bouton **Remediate** (icÃ´ne clÃ©) : lance la correction automatique de cette rÃ¨gle prÃ©cise, si une correction automatique est disponible pour elle. Certaines rÃ¨gles (notamment sur les rÃ©fÃ©rentiels dÃ©claratifs comme OPNsense) n'ont pas de correction automatique et doivent Ãªtre traitÃ©es manuellement.
- Un bouton **Ignore** (icÃ´ne Å“il barrÃ©) : permet de marquer une rÃ¨gle comme volontairement ignorÃ©e sur cet appareil (par exemple si elle ne s'applique pas Ã  ce cas prÃ©cis). La rÃ¨gle passe alors avec un badge **ignored**. Le bouton devient **Unignore** pour revenir en arriÃ¨re.
- Un badge **remediated** apparaÃ®t sur une rÃ¨gle qui vient d'Ãªtre corrigÃ©e automatiquement.

## Corriger plusieurs rÃ¨gles en une fois

Lorsqu'un appareil a plusieurs rÃ¨gles en Ã©chec disposant d'une correction automatique, un bouton **Fix All** (ou **Remediate all (n)**, n Ã©tant le nombre de rÃ¨gles concernÃ©es) permet de toutes les corriger en une seule action, sans avoir Ã  cliquer rÃ¨gle par rÃ¨gle.

## Relancer un contrÃ´le

Un bouton de relance (icÃ´ne de rafraÃ®chissement) permet de redÃ©clencher immÃ©diatement un contrÃ´le de conformitÃ© sur un appareil ou une politique donnÃ©e, par exemple aprÃ¨s une correction manuelle effectuÃ©e directement sur la machine, pour vÃ©rifier que le problÃ¨me est bien rÃ©solu sans attendre le prochain contrÃ´le automatique.

## Bon rÃ©flexe en cas d'appareil rouge

1. Ouvrir le dÃ©tail de l'appareil concernÃ© dans l'onglet RÃ©sultats.
2. Regarder les rÃ¨gles en Ã©chec listÃ©es.
3. Utiliser **Fix All** si plusieurs rÃ¨gles peuvent Ãªtre corrigÃ©es automatiquement, ou **Remediate** rÃ¨gle par rÃ¨gle si vous voulez garder le contrÃ´le sur ce qui est modifiÃ©.
4. Relancer le contrÃ´le pour confirmer que le score est remontÃ©.
5. Si une rÃ¨gle ne peut pas Ãªtre corrigÃ©e automatiquement et ne s'applique pas Ã  cet appareil, utiliser **Ignore** plutÃ´t que de la laisser polluer le score indÃ©finiment.
