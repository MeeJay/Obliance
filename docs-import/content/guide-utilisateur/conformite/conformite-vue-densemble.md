# Conformité : vue d'ensemble

La Conformité permet de vérifier automatiquement que vos appareils respectent des règles de sécurité et de configuration, et de corriger en un clic celles qui ne le sont pas.

## A quoi ça sert

Chaque appareil (poste Windows, serveur Linux, Mac, pare-feu OPNsense, etc.) peut être contrôlé par rapport à un ensemble de règles : un pare-feu doit être actif, un mot de passe doit respecter une longueur minimale, un service dangereux doit être désactivé, une mise à jour doit être installée, etc. Obliance exécute ces contrôles automatiquement sur les appareils, calcule un score de conformité, et propose de corriger automatiquement ce qui ne va pas lorsque c'est possible.

Cela sert par exemple à :

- Vérifier que tous les postes Windows respectent une base de sécurité minimale avant un audit.
- S'assurer qu'un référentiel réglementaire (HIPAA, PCI DSS, ISO 27001...) est bien respecté sur le périmètre concerné.
- Repérer rapidement les machines "à risque" dans le parc et les remettre en conformité sans intervention manuelle poste par poste.

## Où trouver la Conformité

La Conformité se trouve dans le menu **Politiques**, sous l'onglet **Conformité**. Cette page **Politiques** regroupe plusieurs onglets liés à la santé du parc (mises à jour, logiciels, conformité...) ; c'est l'onglet **Conformité** qui nous intéresse ici.

L'onglet Conformité contient lui-même deux sous-onglets :

| Sous-onglet | Rôle |
|---|---|
| **Résultats** | Consulter les scores de conformité par appareil, voir le détail des règles en échec, corriger ou ignorer une règle. |
| **Politiques** | Créer, modifier ou supprimer les politiques de conformité appliquées au parc (à partir d'un préréglage ou entièrement sur mesure). |

## Comment ça fonctionne, en résumé

1. Une **politique de conformité** est un ensemble de règles, rattaché à un référentiel (CIS, NIST, ISO 27001, PCI DSS, HIPAA, SOC 2, ou "Custom" pour les bases maison) et appliqué soit à tous les appareils, soit à un ou plusieurs groupes précis.
2. Chaque règle est contrôlée sur les appareils ciblés. Si elle est respectée, elle passe en "Conforme" ; sinon elle passe en "Non conforme".
3. Pour les règles où une correction automatique existe, un bouton **Remediate** permet de corriger la règle directement depuis l'interface, sans se connecter à la machine.
4. Un score de conformité (en pourcentage) est calculé par appareil et par politique, avec un code couleur : vert si le score est bon, jaune s'il est moyen, rouge s'il est mauvais.

Pour démarrer rapidement, vous n'êtes pas obligé de construire une politique de conformité règle par règle : Obliance propose 12 **préréglages** prêts à l'emploi (voir la page dédiée aux préréglages), que vous pouvez utiliser tels quels ou comme point de départ à personnaliser.
