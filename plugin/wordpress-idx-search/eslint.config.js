import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    {
        files: ['assets/**/*.js'],
        languageOptions: {
            ecmaVersion: 2021,
            sourceType: 'script',
            globals: {
                ...globals.browser,
                // Localized data injected via wp_localize_script().
                idxI18n: 'readonly',
                idxAdmin: 'readonly',
            },
        },
        rules: {
            eqeqeq: ['warn', 'smart'],
        },
    },
    // Turn off any stylistic rules that Prettier owns.
    prettier,
];
