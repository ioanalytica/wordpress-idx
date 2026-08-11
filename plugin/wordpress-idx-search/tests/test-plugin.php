<?php
/**
 * Integration tests for the WordpressIdxSearch plugin class.
 */
class Test_Wordpress_Idx_Search extends WP_UnitTestCase {

	/** @var WordpressIdxSearch */
	private $plugin;

	public function set_up() {
		parent::set_up();
		$this->plugin = new WordpressIdxSearch();
	}

	public function test_sanitize_lang_accepts_known_language() {
		$this->assertSame( 'en', $this->plugin->sanitize_lang( 'en' ) );
		$this->assertSame( 'fr', $this->plugin->sanitize_lang( 'fr' ) );
		$this->assertSame( 'es', $this->plugin->sanitize_lang( 'es' ) );
	}

	public function test_sanitize_lang_falls_back_to_de() {
		$this->assertSame( 'de', $this->plugin->sanitize_lang( 'xx' ) );
		$this->assertSame( 'de', $this->plugin->sanitize_lang( '' ) );
	}

	public function test_sanitize_api_key_only_admin_can_change() {
		update_option( WordpressIdxSearch::OPTION_API_KEY, 'existing-key' );

		$editor = self::factory()->user->create( array( 'role' => 'editor' ) );
		wp_set_current_user( $editor );
		$this->assertSame(
			'existing-key',
			$this->plugin->sanitize_api_key( 'new-key' ),
			'Non-admins must not be able to change the API key.'
		);

		$admin = self::factory()->user->create( array( 'role' => 'administrator' ) );
		wp_set_current_user( $admin );
		$this->assertSame(
			'new-key',
			$this->plugin->sanitize_api_key( 'new-key' ),
			'Admins may set a new API key.'
		);
	}

	public function test_replace_marker_without_marker_is_unchanged() {
		$content = '<p>Nothing to see here.</p>';
		$this->assertSame( $content, $this->plugin->replace_marker( $content ) );
	}

	public function test_replace_marker_injects_form() {
		$this->plugin->register_assets();
		$content = 'before ' . WordpressIdxSearch::MARKER . ' after';
		$out     = $this->plugin->replace_marker( $content );

		$this->assertStringNotContainsString( WordpressIdxSearch::MARKER, $out );
		$this->assertStringContainsString( 'id="idx-search"', $out );
		$this->assertStringContainsString( 'before ', $out );
		$this->assertStringContainsString( ' after', $out );
	}

	public function test_version_is_single_source_of_truth() {
		$plugin_file = dirname( __DIR__ ) . '/wordpress-idx-search.php';
		$data        = get_file_data( $plugin_file, array( 'Version' => 'Version' ) );
		$this->assertSame(
			WordpressIdxSearch::VERSION,
			$data['Version'],
			'Plugin header Version must match the VERSION constant.'
		);

		$readme = file_get_contents( dirname( __DIR__ ) . '/readme.txt' );
		$this->assertMatchesRegularExpression(
			'/^Stable tag: ' . preg_quote( WordpressIdxSearch::VERSION, '/' ) . '$/m',
			$readme,
			'readme.txt Stable tag must match the VERSION constant.'
		);
	}
}
