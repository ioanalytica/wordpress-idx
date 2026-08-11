export default {
    extends: ['stylelint-config-standard'],
    rules: {
        // The assets are hand-authored, not generated; allow expressive names.
        'selector-class-pattern': null,
    },
};
