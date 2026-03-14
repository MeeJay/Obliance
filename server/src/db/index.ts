import knex from 'knex';
import knexConfig from '../../knexfile';

export const db = knex(knexConfig);
