# vscode-phpcs
This linter plugin for [Visual Studio Code](https://code.visualstudio.com/) provides an interface to [phpcs](http://pear.php.net/package/PHP_CodeSniffer/). It will be used with files that have the “PHP” language mode.

## Installation
Visual Studio Code must be installed in order to use this plugin. If Visual Studio Code is not installed, please follow the instructions [here](https://code.visualstudio.com/Docs/editor/setup).

## Linter Installation
Before using this plugin, you must ensure that `phpcs` is installed on your system. The installation can be performed system-wide using [pear](http://pear.php.net/) or project-wide using [composer](https://getcomposer.org/).

Once phpcs is installed, you can proceed to install the vscode-phpcs plugin if it is not yet installed.

> This plugin will detect whether your project has been set up to use phpcs via composer and use the project specific `phpcs` over the system-wide installation of `phpcs` automatically.

### System-wide Installation
The `phpcs` linter can be installed in your system using the PHP Extension and Application Repository (PEAR).

1. Install [php](http://php.net).

2. Install [pear](http://pear.php.net).

3. Install `phpcs` by typing the following in a terminal:
   ```
   pear install PHP_CodeSniffer
   ```

### Project-wide Installation
The `phpcs` linter can be installed in your project using the Composer Dependency Manager for PHP.

1. Install [php](http://php.net).

2. Install [composer](https://getcomposer.org/doc/00-intro.md).

3. Require `phpcs` package by typing the following at the root of your project in a terminal:
	```
	composer require --dev squizlabs/php_codesniffer
	```

### Plugin Installation
1. Open Visual Studio Code.
2. Press `Ctrl+P` on Windows or `Cmd+P` on Mac to open the Quick Open dialog.
3. Type ext install phpcs to find the extension.
4. Press Enter or click the cloud icon to install it.
5. Restart Visual Studio Code when prompted.

## Configuration
There are various options that can be configured by making changes to your user or workspace preferences.

### **phpcs.enable**
This setting controls whether phpcs is enabled and is optional.

> **Default:** true

### **phpcs.standard**
This setting controls the coding standard used by `phpcs` and is optional. You may specify the name or path of the coding standard to use.

The default behavior of this setting is to use the standard set in the `phpcs` global configuration by the following command:
```
phpcs --config-set default_standard <value>
```

> **Default:** null

## Acknowledgements
The extension architecture is based off of the [Language Server Node Example](https://github.com/Microsoft/vscode-languageserver-node-example).

## Contributing and Licensing

The project is hosted on [GitHub](https://github.com/ikappas/vscode-phpcs) where you can [report issues](https://github.com/ikappas/vscode-phpcs/issues), fork
the project and submit pull requests.

The project is available under [MIT license](https://github.com/ikappas/vscode-phpcs/blob/master/LICENSE.md), which allows modification and
redistribution for both commercial and non-commercial purposes.
