# ConformitÃ© : vue d'ensemble

La ConformitÃ© permet de vÃ©rifier automatiquement que vos appareils respectent des rÃ¨gles de sÃ©curitÃ© et de configuration, et de corriger en un clic celles qui ne le sont pas.

## A quoi Ã§a sert

Chaque appareil (poste Windows, serveur Linux, Mac, pare-feu OPNsense, etc.) peut Ãªtre contrÃ´lÃ© par rapport Ã  un ensemble de rÃ¨gles : un pare-feu doit Ãªtre actif, un mot de passe doit respecter une longueur minimale, un service dangereux doit Ãªtre dÃ©sactivÃ©, une mise Ã  jour doit Ãªtre installÃ©e, etc. Obliance exÃ©cute ces contrÃ´les automatiquement sur les appareils, calcule un score de conformitÃ©, et propose de corriger automatiquement ce qui ne va pas lorsque c'est possible.

Cela sert par exemple Ã  :

- VÃ©rifier que tous les postes Windows respectent une base de sÃ©curitÃ© minimale avant un audit.
- S'assurer qu'un rÃ©fÃ©rentiel rÃ©glementaire (HIPAA, PCI DSS, ISO 27001...) est bien respectÃ© sur le pÃ©rimÃ¨tre concernÃ©.
- RepÃ©rer rapidement les machines "Ã  risque" dans le parc et les remettre en conformitÃ© sans intervention manuelle poste par poste.

## OÃ¹ trouver la ConformitÃ©

La ConformitÃ© se trouve dans le menu **Politiques**, sous l'onglet **ConformitÃ©**. Cette page **Politiques** regroupe plusieurs onglets liÃ©s Ã  la santÃ© du parc (mises Ã  jour, logiciels, conformitÃ©...) ; c'est l'onglet **ConformitÃ©** qui nous intÃ©resse ici.

L'onglet ConformitÃ© contient lui-mÃªme deux sous-onglets :

| Sous-onglet | RÃ´le |
|---|---|
| **RÃ©sultats** | Consulter les scores de conformitÃ© par appareil, voir le dÃ©tail des rÃ¨gles en Ã©chec, corriger ou ignorer une rÃ¨gle. |
| **Politiques** | CrÃ©er, modifier ou supprimer les politiques de conformitÃ© appliquÃ©es au parc (Ã  partir d'un prÃ©rÃ©glage ou entiÃ¨rement sur mesure). |

## Comment Ã§a fonctionne, en rÃ©sumÃ©

1. Une **politique de conformitÃ©** est un ensemble de rÃ¨gles, rattachÃ© Ã  un rÃ©fÃ©rentiel (CIS, NIST, ISO 27001, PCI DSS, HIPAA, SOC 2, ou "Custom" pour les bases maison) et appliquÃ© soit Ã  tous les appareils, soit Ã  un ou plusieurs groupes prÃ©cis.
2. Chaque rÃ¨gle est contrÃ´lÃ©e sur les appareils ciblÃ©s. Si elle est respectÃ©e, elle passe en "Conforme" ; sinon elle passe en "Non conforme".
3. Pour les rÃ¨gles oÃ¹ une correction automatique existe, un bouton **Remediate** permet de corriger la rÃ¨gle directement depuis l'interface, sans se connecter Ã  la machine.
4. Un score de conformitÃ© (en pourcentage) est calculÃ© par appareil et par politique, avec un code couleur : vert si le score est bon, jaune s'il est moyen, rouge s'il est mauvais.

Pour dÃ©marrer rapidement, vous n'Ãªtes pas obligÃ© de construire une politique de conformitÃ© rÃ¨gle par rÃ¨gle : Obliance propose 12 **prÃ©rÃ©glages** prÃªts Ã  l'emploi (voir la page dÃ©diÃ©e aux prÃ©rÃ©glages), que vous pouvez utiliser tels quels ou comme point de dÃ©part Ã  personnaliser.
