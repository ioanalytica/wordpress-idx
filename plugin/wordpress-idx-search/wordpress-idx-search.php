<?php
/**
 * Plugin Name: WordPress IDX Search
 * Description: Full-text search interface for the wordpress-idx sidecar API. Use the HTML comment &lt;!-- wordpress-idx-search --&gt; in any post or page to render the search form.
 * Version: 1.1.0
 * Author: IO ANALYTICA
 * Author URI: https://ioanalytica.com
 * License: ISC
 */

if (!defined('ABSPATH')) {
    exit;
}

// Add "Settings" link on the Plugins list page
add_filter('plugin_action_links_' . plugin_basename(__FILE__), function ($links) {
    $url = admin_url('options-general.php?page=idx-search');
    array_unshift($links, '<a href="' . esc_url($url) . '">Settings</a>');
    return $links;
});

class WordpressIdxSearch {

    const MARKER = '<!-- wordpress-idx-search -->';
    const OPTION_LANG = 'idx_search_language';
    const OPTION_API_KEY = 'idx_search_api_key';

    private static $strings = [
        'de' => [
            'loading'        => 'Index wird geladen…',
            'unreachable'    => 'Index nicht erreichbar: ',
            'fulltext'       => 'Volltextsuche',
            'placeholder'    => 'Suchbegriff…',
            'type'           => 'Typ',
            'all'            => 'Alle',
            'posts'          => 'Beiträge',
            'pages'          => 'Seiten',
            'author'         => 'Autor',
            'category'       => 'Kategorie',
            'tag'            => 'Schlagwort',
            'from'           => 'Von',
            'to'             => 'Bis',
            'limit'          => 'Max. Ergebnisse',
            'unlimited'      => 'unbegrenzt',
            'context'        => 'Nur Kontextausschnitt anzeigen',
            'comments'       => 'Kommentare durchsuchen',
            'search'         => 'Suchen',
            'reset'          => 'Zurücksetzen',
            'searching'      => 'Suche läuft…',
            'no_results'     => 'Keine Ergebnisse gefunden.',
            'hits'           => 'Treffer',
            'showing'        => 'zeige',
            'entries'        => 'Einträge',
            'words'          => 'Wörter',
            'to_date'        => 'bis',
            'post'           => 'Beitrag',
            'page'           => 'Seite',
            'comment'        => 'Kommentar',
            'comment_plural' => 'Kommentare',
            'error'          => 'Fehler: ',
            'locale'         => 'de-DE',
            // Admin
            'admin_language'       => 'Sprache',
            'admin_api_key'        => 'Reindex API-Schlüssel',
            'admin_api_key_desc'   => 'API-Schlüssel für',
            'admin_save'           => 'Änderungen speichern',
            'admin_reindex_title'  => 'Index neu aufbauen',
            'admin_reindex_btn'    => 'Index neu aufbauen',
            'admin_reindex_run'    => 'Reindex läuft…',
            'admin_reindex_done'   => 'Fertig – %s Einträge indexiert.',
            'admin_reindex_error'  => 'Fehler: ',
            'admin_no_key'         => 'Kein API-Key konfiguriert.',
        ],
        'en' => [
            'loading'        => 'Loading index…',
            'unreachable'    => 'Index unreachable: ',
            'fulltext'       => 'Full-text search',
            'placeholder'    => 'Search term…',
            'type'           => 'Type',
            'all'            => 'All',
            'posts'          => 'Posts',
            'pages'          => 'Pages',
            'author'         => 'Author',
            'category'       => 'Category',
            'tag'            => 'Tag',
            'from'           => 'From',
            'to'             => 'To',
            'limit'          => 'Max. results',
            'unlimited'      => 'unlimited',
            'context'        => 'Show context snippet only',
            'comments'       => 'Search comments',
            'search'         => 'Search',
            'reset'          => 'Reset',
            'searching'      => 'Searching…',
            'no_results'     => 'No results found.',
            'hits'           => 'hits',
            'showing'        => 'showing',
            'entries'        => 'entries',
            'words'          => 'words',
            'to_date'        => 'to',
            'post'           => 'Post',
            'page'           => 'Page',
            'comment'        => 'comment',
            'comment_plural' => 'comments',
            'error'          => 'Error: ',
            'locale'         => 'en-US',
            // Admin
            'admin_language'       => 'Language',
            'admin_api_key'        => 'Reindex API key',
            'admin_api_key_desc'   => 'API key for',
            'admin_save'           => 'Save changes',
            'admin_reindex_title'  => 'Rebuild index',
            'admin_reindex_btn'    => 'Rebuild index',
            'admin_reindex_run'    => 'Reindexing…',
            'admin_reindex_done'   => 'Done – %s entries indexed.',
            'admin_reindex_error'  => 'Error: ',
            'admin_no_key'         => 'No API key configured.',
        ],
        'fr' => [
            'loading'        => 'Chargement de l\'index…',
            'unreachable'    => 'Index inaccessible : ',
            'fulltext'       => 'Recherche plein texte',
            'placeholder'    => 'Terme de recherche…',
            'type'           => 'Type',
            'all'            => 'Tous',
            'posts'          => 'Articles',
            'pages'          => 'Pages',
            'author'         => 'Auteur',
            'category'       => 'Catégorie',
            'tag'            => 'Étiquette',
            'from'           => 'Du',
            'to'             => 'Au',
            'limit'          => 'Résultats max.',
            'unlimited'      => 'illimité',
            'context'        => 'Afficher uniquement l\'extrait',
            'comments'       => 'Rechercher dans les commentaires',
            'search'         => 'Rechercher',
            'reset'          => 'Réinitialiser',
            'searching'      => 'Recherche en cours…',
            'no_results'     => 'Aucun résultat trouvé.',
            'hits'           => 'résultats',
            'showing'        => 'affichés',
            'entries'        => 'entrées',
            'words'          => 'mots',
            'to_date'        => 'au',
            'post'           => 'Article',
            'page'           => 'Page',
            'comment'        => 'commentaire',
            'comment_plural' => 'commentaires',
            'error'          => 'Erreur : ',
            'locale'         => 'fr-FR',
            // Admin
            'admin_language'       => 'Langue',
            'admin_api_key'        => 'Clé API de réindexation',
            'admin_api_key_desc'   => 'Clé API pour',
            'admin_save'           => 'Enregistrer les modifications',
            'admin_reindex_title'  => 'Reconstruire l\'index',
            'admin_reindex_btn'    => 'Reconstruire l\'index',
            'admin_reindex_run'    => 'Réindexation en cours…',
            'admin_reindex_done'   => 'Terminé – %s entrées indexées.',
            'admin_reindex_error'  => 'Erreur : ',
            'admin_no_key'         => 'Aucune clé API configurée.',
        ],
        'es' => [
            'loading'        => 'Cargando índice…',
            'unreachable'    => 'Índice no disponible: ',
            'fulltext'       => 'Búsqueda de texto completo',
            'placeholder'    => 'Término de búsqueda…',
            'type'           => 'Tipo',
            'all'            => 'Todos',
            'posts'          => 'Entradas',
            'pages'          => 'Páginas',
            'author'         => 'Autor',
            'category'       => 'Categoría',
            'tag'            => 'Etiqueta',
            'from'           => 'Desde',
            'to'             => 'Hasta',
            'limit'          => 'Máx. resultados',
            'unlimited'      => 'ilimitado',
            'context'        => 'Mostrar solo fragmento de contexto',
            'comments'       => 'Buscar en comentarios',
            'search'         => 'Buscar',
            'reset'          => 'Restablecer',
            'searching'      => 'Buscando…',
            'no_results'     => 'No se encontraron resultados.',
            'hits'           => 'resultados',
            'showing'        => 'mostrando',
            'entries'        => 'entradas',
            'words'          => 'palabras',
            'to_date'        => 'a',
            'post'           => 'Entrada',
            'page'           => 'Página',
            'comment'        => 'comentario',
            'comment_plural' => 'comentarios',
            'error'          => 'Error: ',
            'locale'         => 'es-ES',
            // Admin
            'admin_language'       => 'Idioma',
            'admin_api_key'        => 'Clave API de reindexación',
            'admin_api_key_desc'   => 'Clave API para',
            'admin_save'           => 'Guardar cambios',
            'admin_reindex_title'  => 'Reconstruir índice',
            'admin_reindex_btn'    => 'Reconstruir índice',
            'admin_reindex_run'    => 'Reindexando…',
            'admin_reindex_done'   => 'Listo – %s entradas indexadas.',
            'admin_reindex_error'  => 'Error: ',
            'admin_no_key'         => 'No hay clave API configurada.',
        ],
    ];

    public function __construct() {
        add_filter('the_content', [$this, 'replace_marker']);
        add_action('wp_enqueue_scripts', [$this, 'register_assets']);
        add_action('admin_menu', [$this, 'add_admin_menu']);
        add_action('admin_init', [$this, 'register_settings']);
        add_action('admin_enqueue_scripts', [$this, 'enqueue_admin_assets']);
        add_action('wp_ajax_idx_reindex', [$this, 'ajax_reindex']);
    }

    private function get_lang() {
        $lang = get_option(self::OPTION_LANG, 'de');
        return isset(self::$strings[$lang]) ? $lang : 'de';
    }

    private function i18n() {
        return self::$strings[$this->get_lang()];
    }

    // ── Frontend ────────────────────────────────────────────

    public function register_assets() {
        wp_register_style(
            'wordpress-idx-search',
            plugin_dir_url(__FILE__) . 'assets/idx-search.css',
            [],
            '1.1.0'
        );
        wp_register_script(
            'wordpress-idx-search',
            plugin_dir_url(__FILE__) . 'assets/idx-search.js',
            [],
            '1.1.0',
            true
        );
    }

    public function replace_marker($content) {
        if (strpos($content, self::MARKER) === false) {
            return $content;
        }

        wp_enqueue_style('wordpress-idx-search');
        wp_enqueue_script('wordpress-idx-search');
        wp_localize_script('wordpress-idx-search', 'idxI18n', $this->i18n());

        $html = $this->render_search_form();
        return str_replace(self::MARKER, $html, $content);
    }

    private function render_search_form() {
        $t = $this->i18n();
        ob_start();
        ?>
<div id="idx-search" class="idx-search">
    <div class="idx-search__status" id="idx-status"><?php echo esc_html($t['loading']); ?></div>

    <form id="idx-form" class="idx-search__form" style="display:none">
        <div class="idx-search__row">
            <div class="idx-search__field idx-search__field--wide">
                <input type="text" id="idx-q" name="q" placeholder="<?php echo esc_attr($t['fulltext']); ?>">
            </div>
        </div>

        <div class="idx-search__row">
            <div class="idx-search__field">
                <label for="idx-type"><?php echo esc_html($t['type']); ?></label>
                <select id="idx-type" name="type">
                    <option value=""><?php echo esc_html($t['all']); ?></option>
                    <option value="post"><?php echo esc_html($t['posts']); ?></option>
                    <option value="page"><?php echo esc_html($t['pages']); ?></option>
                </select>
            </div>
            <div class="idx-search__field">
                <label for="idx-author"><?php echo esc_html($t['author']); ?></label>
                <select id="idx-author" name="author">
                    <option value=""><?php echo esc_html($t['all']); ?></option>
                </select>
            </div>
            <div class="idx-search__field">
                <label for="idx-category"><?php echo esc_html($t['category']); ?></label>
                <select id="idx-category" name="category">
                    <option value=""><?php echo esc_html($t['all']); ?></option>
                </select>
            </div>
            <div class="idx-search__field">
                <label for="idx-tag"><?php echo esc_html($t['tag']); ?></label>
                <select id="idx-tag" name="tag">
                    <option value=""><?php echo esc_html($t['all']); ?></option>
                </select>
            </div>
        </div>

        <div class="idx-search__row">
            <div class="idx-search__field">
                <label for="idx-from"><?php echo esc_html($t['from']); ?></label>
                <input type="date" id="idx-from" name="from">
            </div>
            <div class="idx-search__field">
                <label for="idx-to"><?php echo esc_html($t['to']); ?></label>
                <input type="date" id="idx-to" name="to">
            </div>
            <div class="idx-search__field">
                <label for="idx-limit"><?php echo esc_html($t['limit']); ?></label>
                <input type="number" id="idx-limit" name="limit" min="1" placeholder="<?php echo esc_attr($t['unlimited']); ?>">
            </div>
        </div>

        <div class="idx-search__row">
            <div class="idx-search__field idx-search__field--checkbox">
                <label>
                    <input type="checkbox" id="idx-context" name="context">
                    <?php echo esc_html($t['context']); ?>
                </label>
            </div>
            <div class="idx-search__field idx-search__field--checkbox">
                <label>
                    <input type="checkbox" id="idx-comments" name="include_comments">
                    <?php echo esc_html($t['comments']); ?>
                </label>
            </div>
        </div>

        <div class="idx-search__row idx-search__actions">
            <button type="submit" class="idx-search__btn"><?php echo esc_html($t['search']); ?></button>
            <button type="reset" class="idx-search__btn idx-search__btn--secondary"><?php echo esc_html($t['reset']); ?></button>
        </div>
    </form>

    <div id="idx-stats" class="idx-search__stats" style="display:none"></div>
    <div id="idx-results" class="idx-search__results"></div>
</div>
        <?php
        return ob_get_clean();
    }

    // ── Admin ───────────────────────────────────────────────

    public function add_admin_menu() {
        add_options_page(
            'IDX Search',
            'IDX Search',
            'edit_posts',
            'idx-search',
            [$this, 'render_admin_page']
        );
    }

    public function register_settings() {
        register_setting('idx_search_settings', self::OPTION_LANG, [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_lang'],
            'default'           => 'de',
        ]);
        register_setting('idx_search_settings', self::OPTION_API_KEY, [
            'type'              => 'string',
            'sanitize_callback' => [$this, 'sanitize_api_key'],
            'default'           => '',
        ]);

        // Allow editors to save the language setting via options.php
        add_filter('option_page_capability_idx_search_settings', function () {
            return 'edit_posts';
        });
    }

    public function sanitize_api_key($value) {
        // Only admins may change the API key
        if (!current_user_can('manage_options')) {
            return get_option(self::OPTION_API_KEY, '');
        }
        return sanitize_text_field($value);
    }

    public function sanitize_lang($value) {
        return isset(self::$strings[$value]) ? $value : 'de';
    }

    public function enqueue_admin_assets($hook) {
        if ($hook !== 'settings_page_idx-search') {
            return;
        }
        $t = $this->i18n();
        wp_enqueue_script(
            'idx-search-admin',
            plugin_dir_url(__FILE__) . 'assets/idx-admin.js',
            [],
            '1.1.0',
            true
        );
        wp_localize_script('idx-search-admin', 'idxAdmin', [
            'ajaxUrl'      => admin_url('admin-ajax.php'),
            'nonce'        => wp_create_nonce('idx_reindex'),
            'reindexRun'   => $t['admin_reindex_run'],
            'reindexDone'  => $t['admin_reindex_done'],
            'reindexError' => $t['admin_reindex_error'],
        ]);
    }

    public function render_admin_page() {
        $lang     = get_option(self::OPTION_LANG, 'de');
        $api_key  = get_option(self::OPTION_API_KEY, '');
        $t        = $this->i18n();
        $is_admin = current_user_can('manage_options');
        $key_disabled = $is_admin ? '' : ' disabled';
        ?>
        <div class="wrap">
            <h1>IDX Search</h1>

            <form method="post" action="options.php">
                <?php settings_fields('idx_search_settings'); ?>
                <table class="form-table">
                    <tr>
                        <th scope="row"><label for="idx_lang"><?php echo esc_html($t['admin_language']); ?></label></th>
                        <td>
                            <select name="<?php echo self::OPTION_LANG; ?>" id="idx_lang">
                                <option value="de" <?php selected($lang, 'de'); ?>>Deutsch</option>
                                <option value="en" <?php selected($lang, 'en'); ?>>English</option>
                                <option value="fr" <?php selected($lang, 'fr'); ?>>Français</option>
                                <option value="es" <?php selected($lang, 'es'); ?>>Español</option>
                            </select>
                        </td>
                    </tr>
                    <tr>
                        <th scope="row"><label for="idx_api_key"><?php echo esc_html($t['admin_api_key']); ?></label></th>
                        <td>
                            <input type="text" name="<?php echo self::OPTION_API_KEY; ?>" id="idx_api_key"
                                   value="<?php echo esc_attr($api_key); ?>" class="regular-text"
                                   autocomplete="off"<?php echo $key_disabled; ?>>
                            <p class="description"><?php echo esc_html($t['admin_api_key_desc']); ?> <code>POST /idx/api/reindex</code></p>
                        </td>
                    </tr>
                </table>
                <?php submit_button($t['admin_save']); ?>
            </form>

            <hr>
            <h2><?php echo esc_html($t['admin_reindex_title']); ?></h2>
            <p>
                <button type="button" id="idx-reindex-btn" class="button button-secondary"><?php echo esc_html($t['admin_reindex_btn']); ?></button>
                <span id="idx-reindex-status"></span>
            </p>
        </div>
        <?php
    }

    public function ajax_reindex() {
        check_ajax_referer('idx_reindex');

        if (!current_user_can('edit_posts')) {
            wp_send_json_error('Unauthorized', 403);
        }

        $t = $this->i18n();
        $api_key = get_option(self::OPTION_API_KEY, '');
        if (empty($api_key)) {
            wp_send_json_error($t['admin_no_key']);
        }

        $response = wp_remote_post(
            site_url('/idx/api/reindex'),
            [
                'headers' => ['Authorization' => 'Bearer ' . $api_key],
                'timeout' => 120,
            ]
        );

        if (is_wp_error($response)) {
            wp_send_json_error($response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $body = json_decode(wp_remote_retrieve_body($response), true);

        if ($code === 200) {
            wp_send_json_success($body);
        } else {
            wp_send_json_error(isset($body['error']) ? $body['error'] : "HTTP $code");
        }
    }
}

new WordpressIdxSearch();
