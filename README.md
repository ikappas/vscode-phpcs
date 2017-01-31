# vscode-phpcs

Integrates [phpcs](https://github.com/squizlabs/PHP_CodeSniffer.git) into VS Code.

## Development setup

- run npm install inside the `phpcs` and `phpcs-server` folders
- open VS Code on `phpcs` and `phpcs-server`

## Developing the server

- open VS Code on `phpcs-server`
- run `npm run compile` or `npm run watch` to build the server and copy it into the `phpcs` folder
- to debug press F5 which attaches a debugger to the server

## Developing the extension/client

- open VS Code on `phpcs`
- run F5 to build and debug the extension
