# vscode-phpcs

[![Current Version](https://vsmarketplacebadge.apphb.com/version/ikappas.phpcs.svg)](https://marketplace.visualstudio.com/items?itemName=ikappas.phpcs)
[![Install Count](https://vsmarketplacebadge.apphb.com/installs/ikappas.phpcs.svg)](https://marketplace.visualstudio.com/items?itemName=ikappas.phpcs)
[![Open Issues](https://vsmarketplacebadge.apphb.com/rating/ikappas.phpcs.svg)](https://marketplace.visualstudio.com/items?itemName=ikappas.phpcs)

Integrates [phpcs](https://github.com/squizlabs/PHP_CodeSniffer.git) into VS Code.

## Development setup

- install the VS Code [npm extension](https://marketplace.visualstudio.com/items?itemName=eg2.vscode-npm-script)
- clone this repository
- open the cloned repository folder using VS Code
- run VS Code task `npm install`

## Developing the server

- open VS Code on `phpcs-server`
- run `npm run compile` or `npm run watch` to build the server and copy it into the `phpcs` folder
- to debug press F5 which attaches a debugger to the server

## Developing the extension/client

To test the development version of the `phpcs` extension:

- open the cloned repository folder using VS Code
- select VS Code folder `phpcs`
- select sidebar option `Debug`
- select option `Client + Server` from the Debug dropdown menu
- press `Start Debugging`

> A new VS Code window will be opened, automatically using the development version of the `phpcs` extension.
