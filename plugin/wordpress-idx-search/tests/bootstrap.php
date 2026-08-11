<?php
/**
 * PHPUnit bootstrap for the WordPress integration test suite.
 *
 * Requires the WordPress test library, installed by bin/install-wp-tests.sh
 * (default location /tmp/wordpress-tests-lib, overridable via WP_TESTS_DIR).
 */

$_tests_dir = getenv( 'WP_TESTS_DIR' );
if ( ! $_tests_dir ) {
	$_tests_dir = rtrim( sys_get_temp_dir(), '/\\' ) . '/wordpress-tests-lib';
}

// Composer autoload so the Yoast PHPUnit Polyfills are available.
require dirname( __DIR__ ) . '/vendor/autoload.php';

if ( false === getenv( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH' ) ) {
	putenv( 'WP_TESTS_PHPUNIT_POLYFILLS_PATH=' . dirname( __DIR__ ) . '/vendor/yoast/phpunit-polyfills' );
}

$_functions = $_tests_dir . '/includes/functions.php';
if ( ! file_exists( $_functions ) ) {
	echo "Could not find {$_functions}. Run bin/install-wp-tests.sh first." . PHP_EOL; // phpcs:ignore
	exit( 1 );
}

require_once $_functions;

/**
 * Load the plugin under test once WordPress' mu-plugins are loaded.
 */
function _idx_manually_load_plugin() {
	require dirname( __DIR__ ) . '/wordpress-idx-search.php';
}
tests_add_filter( 'muplugins_loaded', '_idx_manually_load_plugin' );

require $_tests_dir . '/includes/bootstrap.php';
