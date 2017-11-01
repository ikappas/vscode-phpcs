# vscode-phpcs

This linter plugin for [Visual Studio Code](https://code.visualstudio.com/) provides an interface to [phpcs](http://pear.php.net/package/PHP_CodeSniffer/). It will be used with files that have the “PHP” language mode.

## Installation

Visual Studio Code must be installed in order to use this plugin. If Visual Studio Code is not installed, please follow the instructions [here](https://code.visualstudio.com/Docs/editor/setup).

## Linter Installation

Before using this plugin, you must ensure that `phpcs` is installed on your system. The installation can be performed system-wide using [pear](http://pear.php.net/) or project-wide using [composer](https://getcomposer.org/).

Once phpcs is installed, you can proceed to install the vscode-phpcs plugin if it is not yet installed.

> **NOTE:** This plugin will detect whether your project has been set up to use phpcs via composer and use the project specific `phpcs` over the system-wide installation of `phpcs` automatically.

### System-wide Installation

The `phpcs` linter can be installed in your system using the PHP Extension and Application Repository (PEAR).

1. Install [php](http://php.net).
2. Install [pear](http://pear.php.net).
3. Install `phpcs` by typing the following in a terminal:
    ```bash
    pear install PHP_CodeSniffer
    ```

### Project-wide Installation

The `phpcs` linter can be installed in your project using the Composer Dependency Manager for PHP.

1. Install [php](http://php.net).
2. Install [composer](https://getcomposer.org/doc/00-intro.md).
3. Require `phpcs` package by typing the following at the root of your project in a terminal:
    ```bash
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

[ Optional | **Default**: `true` ]
This setting controls whether `phpcs` linting is enabled.

### **phpcs.standard**

[ Optional | **Default:** `null` ]
This setting controls the coding standard used by `phpcs`. You may specify the name, absolute path or workspace relative path of the coding standard to use.

> **NOTE:** While using composer dependency manager over global installation make sure you use the phpcs commands under your project scope !

The following values are applicable:

1. This setting can be set to `null`, which is the default behavior and uses the `default_standard` when set in the `phpcs` configuration or fallback to the `Pear` coding standard.
    ```json
    {
        "phpcs.standard": null
    }
    ```
    You may set the `default_standard` used by phpcs using the following command:
    ```bash
    phpcs --config-set default_standard <value>
    ```
    or when using composer dependency manager from the root of your project issue the following command:
    ```bash
    ./vendor/bin/phpcs --config-set default_standard <value>
    ```
2. The setting can be set to the name of a built-in coding standard ( ie. `MySource`, `PEAR`, `PHPCS`, `PSR1`, `PSR2`, `Squiz`, `Zend` ) and you are good to go.
    ```json
    {
        "phpcs.standard": "PSR2"
    }
    ```
3. The setting can me set to the name of a custom coding standard ( ie. `WordPress`, `Drupal`, etc. ). In this case you must ensure that the specified coding standard is installed and accessible by `phpcs`.
    ```json
    {
        "phpcs.standard": "WordPress"
    }
    ```
    After you install the custom coding standard, you can make it available to phpcs by issuing the following command:
    ```bash
    phpcs --config-set installed_paths <path/to/custom/coding/standard>
    ```
    or when using composer dependency manager from the root of your project issue the following command:
    ```bash
    ./vendor/bin/phpcs --config-set installed_paths <path/to/custom/coding/standard>
    ```
4. The setting can be set to the absolute path to a custom coding standard:
    ```json
    {
        "phpcs.standard": "/path/to/coding/standard"
    }
    ```
    or you can use the path to a custom ruleset:
    ```json
    {
        "phpcs.standard": "/path/to/project/phpcs.xml"
    }
    ```
5. The setting can be set to your workspace relative path to a custom coding standard:
    ```json
    {
        "phpcs.standard": "./vendor/path/to/coding/standard"
    }
    ```
    or you can use the path to your project's custom ruleset:
    ```json
    {
        "phpcs.standard": "./phpcs.xml"
    }
    ```

### **phpcs.ignorePatterns**

[ Optional | **Type:** `array` | **Default:** `null` ]
This setting controls the files and directories to ignore when linting your documents. You may specify an array of glob patterns to ignore files and directories.

```json
{
    "phpcs.ignorePatterns": [
        "*/ignored-file.php",
        "*/ignored-dir/*"
    ]
}
```

### **phpcs.errorSeverity**

[ Optional | **Type:** `number` | **Default:** `null` ]
This setting controls the error severity level used by `phpcs`. You may specify an integer value.

### **phpcs.warningSeverity**

[ Optional | **Type:** `number` | **Default:** `null` ]
This setting controls the warning severity level used by `phpcs`. You may specify an integer value.

### **phpcs.showSource**

[ Optional | **Default**: `false` ]
This setting controls whether sniff sources are displayed.

### **phpcs.trace.server**

[ Optional | **Default**: `off` ]
This setting controls whether the trace server is activated. Possible values you can use is `off`, `messages` or `verbose`.

## Acknowledgements

The extension architecture is based off of the [Language Server Node Example](https://github.com/Microsoft/vscode-languageserver-node-example).

## Contributing and Licensing

The project is hosted on [GitHub](https://github.com/ikappas/vscode-phpcs) where you can [report issues](https://github.com/ikappas/vscode-phpcs/issues), fork
the project and submit pull requests.

The project is available under [MIT license](https://github.com/ikappas/vscode-phpcs/blob/master/LICENSE.md), which allows modification and
redistribution for both commercial and non-commercial purposes.
